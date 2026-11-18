import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBase, apiFetch } from '../api/client';
import { consumeReturnPath } from '../auth/returnPath';
import { demoRoom, roomPath, roomStorageKey, shouldOpenDemoLobby } from './demoRoom';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('demo room isolation', () => {
  it.each([
    ['1', '1', '/', true],
    ['1', '1', '/squad/rankings', false],
    ['1', '1', '/matchday/', false],
    ['1', '0', '/', false],
    ['0', '1', '/', false],
  ])('only redirects the hosted lobby (%s, %s, %s)', (demo, rooms, path, expected) => {
    vi.stubEnv('VITE_DEMO', demo);
    vi.stubEnv('VITE_DEMO_ROOMS', rooms);
    window.history.replaceState({}, '', path);
    expect(shouldOpenDemoLobby()).toBe(expected);
  });

  it.each(['/squad', '/squad/', '/squad/rankings'])('recognizes the room at %s', (path) => {
    vi.stubEnv('VITE_DEMO', '1');
    window.history.replaceState({}, '', path);
    expect(demoRoom()).toBe('/squad');
    expect(roomPath('/plus-one/test')).toBe('/squad/plus-one/test');
    expect(roomStorageKey('miootz_tokens')).toBe('miootz_tokens:/squad');
  });

  it.each(['/squadron/', '/other/squad/', '/api/demo', '/'])('does not recognize %s as a room', (path) => {
    vi.stubEnv('VITE_DEMO', '1');
    window.history.replaceState({}, '', path);
    expect(demoRoom()).toBe('');
    expect(apiBase()).toBe('/api');
  });

  it('uses only the current room token and API, even when both rooms are signed in', async () => {
    vi.stubEnv('VITE_DEMO', '1');
    vi.stubEnv('VITE_API_BASE', '/custom-api');
    localStorage.setItem('miootz_tokens:/squad', JSON.stringify({ accessToken: 'squad-token' }));
    localStorage.setItem('miootz_tokens:/matchday', JSON.stringify({ accessToken: 'matchday-token' }));
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState({}, '', '/squad/');
    await apiFetch('/meetups');
    window.history.replaceState({}, '', '/matchday/');
    await apiFetch('/meetups');
    expect(fetch).toHaveBeenNthCalledWith(1, '/squad/api/meetups', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer squad-token' }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/matchday/api/meetups', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer matchday-token' }),
    }));
  });

  it('validates a room return path and removes the basename for the router', () => {
    vi.stubEnv('VITE_DEMO', '1');
    window.history.replaceState({}, '', '/squad/plus-one/claim');
    sessionStorage.setItem('miootz_return_path:/squad', '/squad/plus-one/claim?x=1');
    expect(consumeReturnPath()).toBe('/plus-one/claim?x=1');
    sessionStorage.setItem('miootz_return_path:/squad', '/matchday/plus-one/claim');
    expect(consumeReturnPath()).toBe('/');
  });

  it('uses a separate offline database for each room', async () => {
    vi.stubEnv('VITE_DEMO', '1');
    window.history.replaceState({}, '', '/squad/');
    vi.resetModules();
    expect((await import('../offline/db')).OFFLINE_DB_NAME).toBe('miootz-offline:/squad');
    window.history.replaceState({}, '', '/matchday/');
    vi.resetModules();
    expect((await import('../offline/db')).OFFLINE_DB_NAME).toBe('miootz-offline:/matchday');
  });

  it('keeps ordinary production paths and storage unchanged', () => {
    vi.stubEnv('VITE_DEMO', '0');
    window.history.replaceState({}, '', '/squad/rankings');
    expect(demoRoom()).toBe('');
    expect(roomStorageKey('miootz_tokens')).toBe('miootz_tokens');
    expect(roomPath('/plus-one/test')).toBe('/plus-one/test');
  });
});
