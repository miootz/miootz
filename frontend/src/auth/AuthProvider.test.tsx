import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from '../pages/AuthCallbackPage';
import { ProfilePage } from '../pages/ProfilePage';
import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';
import { authorize, handleCallback } from './pocketIdOidc';

vi.mock('./pocketIdOidc', () => ({
  authorize: vi.fn(),
  handleCallback: vi.fn(),
  getPocketIdUrl: () => 'https://auth.example.test',
  logout: vi.fn(),
  refreshTokens: vi.fn(),
}));
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../offline/db', () => ({
  cacheDelete: vi.fn().mockResolvedValue(undefined),
  cacheGet: vi.fn().mockResolvedValue(undefined),
  cachePut: vi.fn().mockResolvedValue(undefined),
}));

const tokens = {
  accessToken: 'test-access-token',
  idToken: 'test-id-token',
  refreshToken: 'test-refresh-token',
  expiresAt: Date.now() + 3_600_000,
};

function Rankings() {
  return <h1>Rankings {useLocation().search}</h1>;
}

function openApp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/rankings" element={<Rankings />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(handleCallback).mockResolvedValue(tokens);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

it('confirms the new session before opening the requested protected route', async () => {
  sessionStorage.setItem('miootz_return_path', '/rankings?year=all');
  let respond!: (response: Response) => void;
  const profile = new Promise<Response>((resolve) => { respond = resolve; });
  const fetchMock = vi.fn().mockReturnValue(profile);
  vi.stubGlobal('fetch', fetchMock);
  openApp('/auth/callback?code=test');

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/me',
    expect.objectContaining({ headers: expect.objectContaining({
      Authorization: 'Bearer test-access-token',
    }) }),
  ));
  expect(screen.getByText('Completing sign-in…')).toBeInTheDocument();
  expect(localStorage.getItem('miootz_tokens')).toBeNull();

  respond(Response.json({ user: { id: 1 }, is_admin: true }));
  expect(await screen.findByRole('heading', { name: 'Rankings ?year=all' })).toBeInTheDocument();
  expect(handleCallback).toHaveBeenCalledOnce();
  expect(localStorage.getItem('miootz_tokens')).toBe(JSON.stringify(tokens));
  expect(authorize).not.toHaveBeenCalled();
});

it.each(['/auth/callback?code=test', '/rankings'])(
  'stops automatic sign-in when the API rejects the session on %s',
  async (path) => {
    if (path === '/rankings') localStorage.setItem('miootz_tokens', JSON.stringify(tokens));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    openApp(path);

    expect(await screen.findByText('Miootz could not verify this sign-in. Please sign in again.'))
      .toBeInTheDocument();
    expect(localStorage.getItem('miootz_tokens')).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
  },
);

it('restores the selected room session without reading the other room token', async () => {
  vi.stubEnv('VITE_DEMO', '1');
  window.history.replaceState({}, '', '/squad/rankings');
  localStorage.setItem('miootz_tokens:/squad', JSON.stringify(tokens));
  localStorage.setItem('miootz_tokens:/matchday', JSON.stringify({ ...tokens, accessToken: 'other-room' }));
  const fetch = vi.fn().mockResolvedValue(Response.json({ user: { id: 1 }, is_admin: true }));
  vi.stubGlobal('fetch', fetch);
  openApp('/rankings');

  expect(await screen.findByRole('heading', { name: 'Rankings' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/squad/api/me', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
  }));
  expect(JSON.parse(localStorage.getItem('miootz_tokens:/matchday')!).accessToken).toBe('other-room');
});

it('keeps the profile header and positions in sync with successful saves', async () => {
  localStorage.setItem('miootz_tokens', JSON.stringify(tokens));
  const profile = {
    user: {
      id: 1, pocket_id_sub: 'test-player', display_name: 'Sam Vale',
      primary_specialty: 'DEF', secondary_specialty: 'MID',
    },
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me') return Response.json(profile);
    if (url === '/api/users/me' && init?.method === 'PATCH') {
      return init.body === '{"primary_specialty":"GK"}'
        ? Response.json({ detail: 'Position could not be saved' }, { status: 500 })
        : Response.json({ message: 'Profile updated successfully' });
    }
    if (url === '/api/users/1/history?limit=25&offset=0&history_only=1') {
      return Response.json({ history: { items: [], total: 0 } });
    }
    if (url === '/api/users/me/progress') {
      return Response.json({ computed_scores: true, meetups: [] });
    }
    return url.endsWith('/stats')
      ? new Response(null, { status: 503 })
      : Response.json({ items: [] });
  });
  vi.stubGlobal('fetch', fetch);
  openApp('/profile');

  const heading = await screen.findByRole('heading', { name: 'Sam Vale' });
  const header = within(heading.closest('section')!);
  const primary = screen.getByLabelText('Primary position');
  const secondary = screen.getByLabelText('Secondary position');
  expect(header.getByText('Defender', { selector: 'span' })).toBeInTheDocument();

  fireEvent.change(primary, { target: { value: 'ATT' } });
  expect(await header.findByText('Attacker', { selector: 'span' })).toBeInTheDocument();
  expect(primary).toHaveValue('ATT');
  fireEvent.change(primary, { target: { value: 'DEF' } });
  expect(await header.findByText('Defender', { selector: 'span' })).toBeInTheDocument();
  expect(primary).toHaveValue('DEF');

  fireEvent.change(secondary, { target: { value: '' } });
  await waitFor(() => expect(header.queryByText('Midfielder', { selector: 'span' })).not.toBeInTheDocument());
  expect(secondary).toHaveValue('');

  fireEvent.change(primary, { target: { value: 'GK' } });
  expect(await screen.findByText('Position could not be saved')).toBeInTheDocument();
  expect(header.getByText('Defender', { selector: 'span' })).toBeInTheDocument();
  expect(primary).toHaveValue('DEF');
});
