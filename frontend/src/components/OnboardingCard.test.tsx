import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { OnboardingCard } from './OnboardingCard';

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
