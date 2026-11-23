import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { MeetupActionPage, MeetupReservationPage } from './MeetupActionPage';
import { joinMeetup, reserveMeetupSignup } from '../api/meetupsApi';

vi.mock('../api/meetupsApi');
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

beforeEach(() => vi.clearAllMocks());

function openInvitation(path = '/meetup-action?mid=1&act=join') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/meetup-reservation" element={<MeetupReservationPage />} />
        <Route path="/meetup-action" element={<MeetupActionPage />} />
        <Route path="/" element={<p>Meetup details</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('joins directly from an invitation and opens the meetup', async () => {
  vi.mocked(joinMeetup).mockResolvedValue({ status: 'confirmed' });
  openInvitation();
  expect(await screen.findByText("You've joined the meetup!")).toBeInTheDocument();
  expect(joinMeetup).toHaveBeenCalledExactlyOnceWith(1);
  await waitFor(() => expect(screen.getByText('Meetup details')).toBeInTheDocument(), { timeout: 2500 });
});

it('opens an existing signup when the invitation is tapped again', async () => {
  vi.mocked(joinMeetup).mockRejectedValue(new Error('Already joined meetup'));
  openInvitation();
  expect(await screen.findByText("You're already signed up. Opening the meetup…")).toBeInTheDocument();
  expect(showToast).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('Meetup details')).toBeInTheDocument(), { timeout: 2500 });
});

it('describes a waitlisted signup accurately', async () => {
  vi.mocked(joinMeetup).mockResolvedValue({ status: 'waitlisted' });
  openInvitation();
  expect(await screen.findByText("You're on the waitlist.")).toBeInTheDocument();
});

it('keeps other signup failures visible', async () => {
  vi.mocked(joinMeetup).mockRejectedValue(new Error('Meetup not found'));
  openInvitation();
  expect(await screen.findByText('Meetup not found')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Error' })).toBeInTheDocument();
});

it('reserves the notification tap before trying to join', async () => {
  vi.mocked(reserveMeetupSignup).mockResolvedValue({ meetup_id: 1, hold_id: 4 });
  vi.mocked(joinMeetup).mockResolvedValue({ status: 'confirmed' });
  openInvitation('/meetup-reservation#hold=notification-token');
  expect(await screen.findByText("You've joined the meetup!")).toBeInTheDocument();
  expect(reserveMeetupSignup).toHaveBeenCalledExactlyOnceWith('notification-token', expect.any(AbortSignal));
  expect(joinMeetup).toHaveBeenCalledExactlyOnceWith(1, 4);
  expect(reserveMeetupSignup).toHaveBeenCalledBefore(vi.mocked(joinMeetup));
});

it('lets players retry at the current place after a hold expires', async () => {
  vi.mocked(joinMeetup)
    .mockResolvedValueOnce({ status: 'reservation_expired' })
    .mockResolvedValueOnce({ status: 'waitlisted' });
  openInvitation('/meetup-action?mid=1&act=join&reservation=4');
  fireEvent.click(await screen.findByRole('button', { name: 'Join now' }));
  expect(await screen.findByText("You're on the waitlist.")).toBeInTheDocument();
  expect(joinMeetup).toHaveBeenNthCalledWith(2, 1);
});
