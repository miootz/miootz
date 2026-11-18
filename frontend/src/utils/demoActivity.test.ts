import { afterEach, expect, it, vi } from 'vitest';
import { startDemoActivity } from './demoActivity';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

it('signals only trusted foreground interaction, throttles it, and removes listeners', () => {
  vi.stubEnv('VITE_DEMO', '1');
  window.history.replaceState({}, '', '/matchday/');
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  const listeners = new Map<string, EventListener>();
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
    listeners.set(type, listener as EventListener);
  });
  const remove = vi.spyOn(window, 'removeEventListener');
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('visible');
  const stop = startDemoActivity('matchday-token');
  const interaction = listeners.get('pointerdown')!;

  interaction({ isTrusted: false } as Event);
  visibility.mockReturnValue('hidden');
  interaction({ isTrusted: true } as Event);
  expect(fetch).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  interaction({ isTrusted: true } as Event);
  interaction({ isTrusted: true } as Event);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith('/matchday/api/demo/activity', expect.objectContaining({
    method: 'POST', headers: { Authorization: 'Bearer matchday-token' },
  }));
  vi.advanceTimersByTime(30_000);
  interaction({ isTrusted: true } as Event);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
  expect(remove).toHaveBeenCalledTimes(3);
});
