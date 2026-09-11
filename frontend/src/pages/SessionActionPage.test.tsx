import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { SessionActionPage } from './SessionActionPage';
import { joinSession } from '../api/sessionsApi';

vi.mock('../api/sessionsApi');
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

beforeEach(() => vi.clearAllMocks());

function openInvitation() {
  render(
    <MemoryRouter initialEntries={['/session-action?sid=1&act=join']}>
      <Routes>
        <Route path="/session-action" element={<SessionActionPage />} />
        <Route path="/sessions/1" element={<p>Meetup details</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('joins directly from an invitation and opens the meetup', async () => {
  vi.mocked(joinSession).mockResolvedValue({ status: 'confirmed' });
  openInvitation();
  expect(await screen.findByText("You've joined the session!")).toBeInTheDocument();
  expect(joinSession).toHaveBeenCalledExactlyOnceWith(1);
  await waitFor(() => expect(screen.getByText('Meetup details')).toBeInTheDocument(), { timeout: 2500 });
});

it('opens an existing signup when the invitation is tapped again', async () => {
  vi.mocked(joinSession).mockRejectedValue(new Error('Already joined session'));
  openInvitation();
  expect(await screen.findByText("You're already signed up. Opening the meetup…")).toBeInTheDocument();
  expect(showToast).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('Meetup details')).toBeInTheDocument(), { timeout: 2500 });
});

it('describes a waitlisted signup accurately', async () => {
  vi.mocked(joinSession).mockResolvedValue({ status: 'waitlisted' });
  openInvitation();
  expect(await screen.findByText("You're on the waitlist.")).toBeInTheDocument();
});

it('keeps other signup failures visible', async () => {
  vi.mocked(joinSession).mockRejectedValue(new Error('Session not found'));
  openInvitation();
  expect(await screen.findByText('Session not found')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Error' })).toBeInTheDocument();
});
