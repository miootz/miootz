import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client';
import { subscribeToWebPush, unsubscribeFromWebPush } from './pushSubscription';

vi.mock('../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client')>(),
  apiFetch: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('does not use a root push subscription from a hosted room', async () => {
  vi.stubEnv('VITE_DEMO', '1');
  window.history.replaceState({}, '', '/squad/');
  await expect(subscribeToWebPush()).resolves.toEqual({ ok: false, reason: 'Not supported in this browser' });
  await unsubscribeFromWebPush();
  expect(apiFetch).not.toHaveBeenCalled();
});

it('reports granted permission before waiting for push subscription', async () => {
  const subscribe = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('navigator', Object.create(navigator, {
    serviceWorker: { value: { getRegistration: vi.fn().mockResolvedValue({ active: {}, pushManager: { subscribe } }) } },
  }));
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') });
  vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ publicKey: 'AA' }), { status: 200 }));
  const onGranted = vi.fn();

  void subscribeToWebPush(onGranted);
  await waitFor(() => expect(onGranted).toHaveBeenCalledOnce());
  expect(subscribe).toHaveBeenCalledOnce();
  expect(onGranted.mock.invocationCallOrder[0]).toBeLessThan(subscribe.mock.invocationCallOrder[0]);
});

it('does not report a grant when permission is denied', async () => {
  vi.stubGlobal('navigator', Object.create(navigator, {
    serviceWorker: { value: { getRegistration: vi.fn().mockResolvedValue({ active: {} }) } },
  }));
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('denied') });
  vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ publicKey: 'AA' }), { status: 200 }));
  const onGranted = vi.fn();

  await expect(subscribeToWebPush(onGranted)).resolves.toEqual({ ok: false, reason: 'Notification permission denied' });
  expect(onGranted).not.toHaveBeenCalled();
});

it('shows the server reason when it rejects a subscription', async () => {
  const subscribe = vi.fn().mockResolvedValue({
    toJSON: () => ({ endpoint: 'https://example.test/send', keys: { p256dh: 'key', auth: 'secret' } }),
  });
  vi.stubGlobal('navigator', Object.create(navigator, {
    serviceWorker: { value: { getRegistration: vi.fn().mockResolvedValue({ active: {}, pushManager: { subscribe } }) } },
  }));
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') });
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(new Response(JSON.stringify({ publicKey: 'AA' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Push endpoint host not allowed' }), { status: 400 }));

  await expect(subscribeToWebPush()).resolves.toEqual({ ok: false, reason: 'Push endpoint host not allowed' });
});
