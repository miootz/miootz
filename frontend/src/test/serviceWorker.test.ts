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
});
