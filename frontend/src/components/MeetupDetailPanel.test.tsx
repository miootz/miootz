import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function prepareReview(myReview: 'poorly' | 'expected' | 'well' | 'excellent' | null = null) {
  vi.mocked(fetchMeetupTeams).mockResolvedValue({
    meetup_id: 7,
    content_revision: 0,
    teams: [{
      id: 'a',
      name: 'A',
      players: [{ id: '2', name: 'Alex', skillScore: 3, calculatedSkill: 3.7, isLocked: false }],
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
    ratees: [{ user_id: 2, display_name: 'Alex', avatar_url: null, my_review: myReview }],
  });
}

it('shows the default without voting, saves an explicit neutral review and clears it', async () => {
  prepareReview();
  vi.mocked(submitRating).mockReset().mockResolvedValue();

  render(<MeetupDetailPanel meetupId={7} />);
  const group = await screen.findByRole('group', { name: 'Your review of Alex' });
  const neutral = within(group).getByRole('button', { name: 'okay' });
  const well = within(group).getByRole('button', { name: 'good' });

  expect(neutral).toHaveAttribute('aria-pressed', 'true');
  expect(group).toHaveAccessibleDescription('Okay is selected by default. Select a review to save it.');
  expect(within(group).getAllByRole('button')).toHaveLength(4);
  expect(within(group).getByRole('button', { name: 'poor' })).toHaveTextContent('😥');
  expect(neutral).toHaveTextContent('😐');
  expect(well).toHaveTextContent('😏');
  expect(within(group).getByRole('button', { name: 'great' })).toHaveTextContent('🤩');
  expect(submitRating).not.toHaveBeenCalled();

  fireEvent.click(neutral);
  await waitFor(() => expect(submitRating).toHaveBeenLastCalledWith(7, 2, 'expected'));
  expect(group).toHaveAccessibleDescription('Activate the selected review again to clear it.');

  fireEvent.click(neutral);
  await waitFor(() => expect(submitRating).toHaveBeenLastCalledWith(7, 2, null));
  expect(neutral).toHaveAttribute('aria-pressed', 'true');
  expect(group).toHaveAccessibleDescription('Okay is selected by default. Select a review to save it.');

  fireEvent.click(well);
  await waitFor(() => expect(submitRating).toHaveBeenLastCalledWith(7, 2, 'well'));
  expect(well).toHaveAttribute('aria-pressed', 'true');
  expect(neutral).toHaveAttribute('aria-pressed', 'false');
});

it('shows a saved review and clears it when activated again', async () => {
  prepareReview('excellent');
  vi.mocked(submitRating).mockReset().mockResolvedValue();

  render(<MeetupDetailPanel meetupId={7} />);
  const group = await screen.findByRole('group', { name: 'Your review of Alex' });
  const excellent = within(group).getByRole('button', { name: 'great' });
  expect(excellent).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(excellent);
  await waitFor(() => expect(submitRating).toHaveBeenCalledWith(7, 2, null));
  expect(within(group).getByRole('button', { name: 'okay' })).toHaveAttribute('aria-pressed', 'true');
});

it('does not offer review controls when peer ratings are off', async () => {
  prepareReview();
  vi.mocked(fetchRatingContext).mockResolvedValue({
    peer_rating_mode: 'off', meetup_id: 7, meetup_start_time: '', meetup_end_time: '',
    before_meetup_end: false, ratings_locked: false, ratings_editable: false, ratings_lock_at: null,
    viewer_attended: true, ratees: [],
  });
  render(<MeetupDetailPanel meetupId={7} />);
  await screen.findByText('Alex');
  expect(screen.queryByRole('group', { name: 'Your review of Alex' })).toBeNull();
});

it('saves rapid changes in order so an older request cannot overwrite the latest', async () => {
  prepareReview();
  let finishFirst!: () => void;
  vi.mocked(submitRating).mockReset()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
    .mockResolvedValue();

  render(<MeetupDetailPanel meetupId={7} />);
  const group = await screen.findByRole('group', { name: 'Your review of Alex' });
  fireEvent.click(within(group).getByRole('button', { name: 'poor' }));
  fireEvent.click(within(group).getByRole('button', { name: 'good' }));
  await waitFor(() => expect(submitRating).toHaveBeenCalledTimes(1));
  expect(submitRating).toHaveBeenCalledWith(7, 2, 'poorly');
  expect(within(group).getByRole('button', { name: 'good' })).toHaveAttribute('aria-pressed', 'true');
  finishFirst();
  await waitFor(() => expect(submitRating).toHaveBeenCalledTimes(2));
  expect(submitRating).toHaveBeenLastCalledWith(7, 2, 'well');
});
