import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StarRating } from './StarRating';

function mockRect(el: HTMLElement, width = 20) {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: 20,
      width,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    }) as DOMRect;
}

it('whole steps: click sets an integer value', () => {
  const onChange = vi.fn();
  render(<StarRating value={2} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '3 stars' }));
  expect(onChange).toHaveBeenCalledWith(3);
});

it('half steps: left half of a star gives n.5, right half n', () => {
  const onChange = vi.fn();
  render(<StarRating value={2} onChange={onChange} halfSteps />);
  const star4 = screen.getByRole('button', { name: '3.5 / 4 stars' });
  mockRect(star4);
  fireEvent.click(star4, { clientX: 4 });
  expect(onChange).toHaveBeenLastCalledWith(3.5);
  fireEvent.click(star4, { clientX: 16 });
  expect(onChange).toHaveBeenLastCalledWith(4);
});

it('readonly renders a half star without calling onChange', () => {
  const { container } = render(
    <StarRating value={3.5} readonly size={16} />,
  );
  // The 4th star carries a 50%-width clipped overlay (half fill).
  const overlays = container.querySelectorAll<HTMLElement>(
    'span[style*="width: 50%"]',
  );
  expect(overlays.length).toBe(1);
  const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
  expect(buttons.every((b) => b.disabled)).toBe(true);
});

it('lets an unrated player be rated and a rating be cleared', () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <StarRating value={0} onChange={onChange} label="Your rating of Alex" clearable />,
  );
  const clear = screen.getByRole('button', { name: 'Clear Your rating of Alex' });
  const first = screen.getByRole('button', { name: '1 star, Your rating of Alex' });
  expect(clear).toBeDisabled();
  expect(first).toBeEnabled();
  expect(first).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(first);
  expect(onChange).toHaveBeenLastCalledWith(1);

  rerender(<StarRating value={3} onChange={onChange} label="Your rating of Alex" clearable />);
  expect(clear).toBeEnabled();
  expect(screen.getByRole('button', { name: '3 stars, Your rating of Alex' }))
    .toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(clear);
  expect(onChange).toHaveBeenLastCalledWith(0);

  rerender(<StarRating value={0} readonly label="Your rating of Alex" clearable />);
  expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled')))
    .toBe(true);
});
