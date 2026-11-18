import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from '../pages/AuthCallbackPage';
import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';
import { authorize, handleCallback } from './pocketIdOidc';

vi.mock('./pocketIdOidc', () => ({
  authorize: vi.fn(),
  handleCallback: vi.fn(),
  logout: vi.fn(),
  refreshTokens: vi.fn(),
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

afterEach(() => vi.unstubAllGlobals());

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
