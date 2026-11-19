import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StarRating } from './StarRating';

it('previews half-star changes while dragging and saves the final value once', () => {
  const onChange = vi.fn();
  render(<StarRating value={2} onChange={onChange} />);
  const slider = screen.getByRole('slider', { name: 'Rating' });
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: '1.5' } });
  fireEvent.change(slider, { target: { value: '3.5' } });
  expect(slider).toHaveAttribute('aria-valuetext', '3.5 out of 5 stars');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(3.5);
});

it('uses half steps for keyboard changes and respects the peer minimum', () => {
  const onChange = vi.fn();
  render(<StarRating value={null} onChange={onChange} min={1} />);
  const slider = screen.getByRole('slider', { name: 'Rating' });
  expect(slider).toHaveAttribute('step', '0.5');
  expect(slider).toHaveAttribute('aria-valuemin', '1');
  expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  fireEvent.change(slider, { target: { value: '1.5' } });
  expect(onChange).toHaveBeenCalledWith(1.5);
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: '0.5' } });
  fireEvent.pointerUp(slider);
  expect(onChange).toHaveBeenLastCalledWith(1);
});

it('clears ratings and keeps a saved zero distinct from an unset value', () => {
  const onClear = vi.fn();
  const { rerender } = render(<StarRating value={0} onChange={vi.fn()} onClear={onClear} />);
  const clear = screen.getByRole('button', { name: 'Clear Rating' });
  expect(clear).toBeEnabled();
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '0 out of 5 stars');
  fireEvent.click(clear);
  expect(onClear).toHaveBeenCalledOnce();
  rerender(<StarRating value={null} onChange={vi.fn()} onClear={onClear} />);
  expect(clear).toBeDisabled();
});

it('lets keyboard users select the minimum from an unset rating or legacy zero', () => {
  const onChange = vi.fn();
  const { rerender } = render(<StarRating value={null} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(0.5);
  rerender(<StarRating value={0} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' });
  expect(onChange).toHaveBeenLastCalledWith(0.5);
});

it('moves from an existing non-half-star value to the next half step', () => {
  const onChange = vi.fn();
  render(<StarRating value={3.3} onChange={onChange} />);
  const slider = screen.getByRole('slider');
  expect(slider).toBeValid();
  expect(slider).toHaveAttribute('aria-valuetext', '3.3 out of 5 stars');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(3.5);
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  expect(onChange).toHaveBeenLastCalledWith(3);
});

it('renders a readonly half star', () => {
  const { container } = render(<StarRating value={3.5} readonly size={16} />);
  expect(container.querySelectorAll('span[style*="width: 50%"]')).toHaveLength(1);
  expect(screen.queryByRole('slider')).toBeNull();
});
