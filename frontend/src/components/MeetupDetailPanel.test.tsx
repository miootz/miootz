import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { fetchMeetupTeams } from '../api/meetupsApi';
import { fetchRatingContext, submitRating } from '../api/ratingsApi';
import { MeetupDetailPanel } from './MeetupDetailPanel';

vi.mock('../api/meetupsApi');
vi.mock('../api/ratingsApi');
vi.mock('../api/client', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => [] }),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ me: null }) }));
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('./MatchHistoryList', () => ({ MatchHistoryList: () => null }));

it('saves and clears an initially blank rating in History', async () => {
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 7,
    content_revision: 0,
    teams: [{
      id: 'a',
      name: 'A',
      players: [{ id: '2', name: 'Alex', skillScore: 3, isLocked: false }],
    }],
  });
  vi.mocked(fetchRatingContext).mockResolvedValue({
    meetup_id: 7,
    meetup_start_time: '',
    meetup_end_time: '',
    before_meetup_end: false,
    ratings_locked: false,
    ratings_editable: true,
    ratings_lock_at: null,
    viewer_attended: true,
    ratees: [{ user_id: 2, display_name: 'Alex', avatar_url: null, my_score: null }],
  });
  vi.mocked(submitRating).mockResolvedValue();

  render(<MeetupDetailPanel meetupId={7} />);
  const rating = await screen.findByRole('slider', { name: 'Your rating of Alex' });
  const clear = screen.getByRole('button', { name: 'Clear Your rating of Alex' });
  expect(rating).toHaveAttribute('aria-valuetext', 'Not rated');
  expect(clear).toBeDisabled();

  fireEvent.change(rating, { target: { value: '1.5' } });
  await waitFor(() => expect(submitRating).toHaveBeenLastCalledWith(7, 2, 1.5));
  expect(rating).toHaveAttribute('aria-valuetext', '1.5 out of 5 stars');
  expect(clear).toBeEnabled();

  fireEvent.click(clear);
  await waitFor(() => expect(submitRating).toHaveBeenLastCalledWith(7, 2, 0));
  expect(clear).toBeDisabled();
  expect(rating).toHaveAttribute('aria-valuetext', 'Not rated');
});

it('does not offer rating controls when peer ratings are off', async () => {
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 7, content_revision: 0,
    teams: [{ id: 'a', name: 'A', players: [{ id: '2', name: 'Alex', skillScore: 3, isLocked: false }] }],
  });
  vi.mocked(fetchRatingContext).mockResolvedValue({
    peer_rating_mode: 'off', meetup_id: 7, meetup_start_time: '', meetup_end_time: '',
    before_meetup_end: false, ratings_locked: false, ratings_editable: false, ratings_lock_at: null,
    viewer_attended: true, ratees: [],
  });
  render(<MeetupDetailPanel meetupId={7} />);
  await screen.findByText('Alex');
  expect(screen.queryByRole('slider', { name: 'Your rating of Alex' })).toBeNull();
});

it('saves rapid changes in order so an older request cannot overwrite the latest', async () => {
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 7, content_revision: 0,
    teams: [{ id: 'a', name: 'A', players: [{ id: '2', name: 'Alex', skillScore: 3, isLocked: false }] }],
  });
  vi.mocked(fetchRatingContext).mockResolvedValue({
    meetup_id: 7, meetup_start_time: '', meetup_end_time: '', before_meetup_end: false,
    ratings_locked: false, ratings_editable: true, ratings_lock_at: null,
    viewer_attended: true,
    ratees: [{ user_id: 2, display_name: 'Alex', avatar_url: null, my_score: null }],
  });
  let finishFirst!: () => void;
  vi.mocked(submitRating).mockReset()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
    .mockResolvedValue();

  render(<MeetupDetailPanel meetupId={7} />);
  const rating = await screen.findByRole('slider', { name: 'Your rating of Alex' });
  fireEvent.change(rating, { target: { value: '1.5' } });
  fireEvent.change(rating, { target: { value: '3.5' } });
  await waitFor(() => expect(submitRating).toHaveBeenCalledTimes(1));
  expect(rating).toHaveAttribute('aria-valuetext', '3.5 out of 5 stars');
  finishFirst();
  await waitFor(() => expect(submitRating).toHaveBeenCalledTimes(2));
  expect(submitRating).toHaveBeenLastCalledWith(7, 2, 3.5);
});
