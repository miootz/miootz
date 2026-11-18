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
  const first = await screen.findByRole('button', { name: '1 star, Your rating of Alex' });
  const clear = screen.getByRole('button', { name: 'Clear Your rating of Alex' });
  expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(clear).toBeDisabled();

  fireEvent.click(first);
  await waitFor(() => expect(first).toHaveAttribute('aria-pressed', 'true'));
  expect(submitRating).toHaveBeenLastCalledWith(7, 2, 1);
  expect(clear).toBeEnabled();

  fireEvent.click(clear);
  await waitFor(() => expect(clear).toBeDisabled());
  expect(submitRating).toHaveBeenLastCalledWith(7, 2, 0);
  expect(first).toHaveAttribute('aria-pressed', 'false');
});
