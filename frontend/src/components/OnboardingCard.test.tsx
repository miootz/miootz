import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingCard } from './OnboardingCard';

const { fetchRatingSettings } = vi.hoisted(() => ({ fetchRatingSettings: vi.fn() }));
vi.mock('../api/ratingSettingsApi', () => ({ fetchRatingSettings }));

beforeEach(() => fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: 'everyone' }));
beforeEach(() => localStorage.clear());

describe('OnboardingCard', () => {
  it('keeps a dismissal after remount and does not hide onboarding for another user', () => {
    const { unmount } = render(<OnboardingCard userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss onboarding' }));
    expect(localStorage.getItem('miootz:onboarding:v1:alice')).toBe('1');
    unmount();

    const next = render(<OnboardingCard userId="alice" />);
    expect(screen.queryByText('Join the next meetup')).not.toBeInTheDocument();
    next.rerender(<OnboardingCard key="bob" userId="bob" />);
    expect(screen.getByText('Join the next meetup')).toBeInTheDocument();
  });

  it('keeps completion after remount and omits the rating explanation', () => {
    const { unmount } = render(<OnboardingCard userId="alice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Before each meetup we balance teams using your skill rating.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    unmount();

    render(<OnboardingCard userId="alice" />);
    expect(screen.queryByText('Join the next meetup')).not.toBeInTheDocument();
    expect(localStorage.getItem('miootz:onboarding:v1:alice')).toBe('1');
  });
});

it('skips the peer-rating step when peer ratings are off', async () => {
  fetchRatingSettings.mockResolvedValue({ computed_scores: true, peer_rating_mode: 'off' });
  render(<OnboardingCard userId="alice" />);
  expect(await screen.findByText('New to Miootz? · Step 1 of 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByText('Rate your teammates')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
});
