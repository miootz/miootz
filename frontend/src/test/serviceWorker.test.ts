/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('service worker API requests', () => {
  it.each(['/api/users/me', '/api/sessions', '/api/sessions/42'])(
    'handles the selected path %s', async (path) => {
      const listeners: Record<string, (event: unknown) => void> = {};
      const response = { ok: false };
      const fetch = vi.fn().mockResolvedValue(response);
      runInNewContext(readFileSync('public/sw.js', 'utf8'), {
        URL,
        self: {
          location: { origin: 'https://miootz.test' },
          addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; },
        },
        caches: { open: async () => ({ match: async () => undefined }) },
        fetch,
      });
      const respondWith = vi.fn();
      const request = { method: 'GET', url: `https://miootz.test${path}` };

      listeners.fetch({ request, respondWith });

      expect(respondWith).toHaveBeenCalledOnce();
      await expect(respondWith.mock.calls[0][0]).resolves.toBe(response);
      expect(fetch).toHaveBeenCalledWith(request);
    },
  );

  it.each(['/', '/squad/', '/matchday/'])('never caches room API requests in worker scope %s', (scope) => {
    const listeners: Record<string, (event: unknown) => void> = {};
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      URL,
      self: {
        location: { origin: 'https://miootz.test' },
        registration: { scope: `https://miootz.test${scope}` },
        addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; },
      },
    });
    const respondWith = vi.fn();
    listeners.fetch({ request: { method: 'GET', url: 'https://miootz.test/squad/api/users/me' }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    if (scope !== '/') {
      const waitUntil = vi.fn();
      listeners.sync({ tag: 'miootz-outbox', waitUntil });
      expect(waitUntil).not.toHaveBeenCalled();
    }
  });

  it('does not handle push events in a hosted room', () => {
    const listeners: Record<string, (event: unknown) => void> = {};
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      URL,
      self: {
        location: { origin: 'https://miootz.test' },
        registration: { scope: 'https://miootz.test/matchday/' },
        addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; },
      },
    });
    const waitUntil = vi.fn();
    listeners.push({ waitUntil });
    listeners.notificationclick({ waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it.each(['', 'action-0'])('reserves a signup immediately for notification action %s', async (action) => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const openWindow = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      URL, URLSearchParams, fetch,
      self: {
        location: { origin: 'https://miootz.test' },
        clients: { matchAll: async () => [], openWindow },
        addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; },
      },
    });
    const waitUntil = vi.fn();
    listeners.notificationclick({
      action, waitUntil,
      notification: {
        close: vi.fn(), data: {
          url: '/meetup-reservation#hold=abc',
          actionMap: { 'action-0': 'https://miootz.test/meetup-reservation#hold=abc' },
        },
      },
    });
    await waitUntil.mock.calls[0][0];
    expect(fetch).toHaveBeenCalledWith('/api/meetups/signup-hold', expect.objectContaining({
      method: 'POST', credentials: 'omit', body: '{"token":"abc"}',
    }));
    expect(openWindow).toHaveBeenCalledWith('/meetup-reservation#hold=abc');
  });
});
