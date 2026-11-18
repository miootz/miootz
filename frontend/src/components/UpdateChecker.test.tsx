import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateChecker } from './UpdateChecker';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

function html(script: string, version?: string) {
  return `<html><head>${version ? `<meta name="app-version" content="${version}">` : ''}
    <script type="module" src="${script}"></script></head></html>`;
}

function response(body: string) {
  return { ok: true, url: `${window.location.origin}/`, text: async () => body };
}

beforeEach(() => {
  vi.stubEnv('PROD', true);
  showToast.mockReset();
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/assets/index-current.js';
  script.dataset.testUpdate = '';
  document.head.append(script);
  const meta = document.createElement('meta');
  meta.name = 'app-version';
  meta.content = '1.0.0';
  meta.dataset.testUpdate = '';
  document.head.append(meta);
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-test-update]').forEach((element) => element.remove());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UpdateChecker', () => {
  it('does not announce the current build when its script URL is relative', async () => {
    const fetch = vi.fn().mockResolvedValue(response(html('/assets/index-current.js', '1.0.0')));
    vi.stubGlobal('fetch', fetch);

    await act(async () => { render(<StrictMode><UpdateChecker /></StrictMode>); });

    expect(fetch).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('announces the destination version once, even with overlapping checks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(html('/assets/index-next.js', '1.0.1'))));

    await act(async () => { render(<StrictMode><UpdateChecker /></StrictMode>); });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('An app update is available (v1.0.1).', 'default', 0,
      expect.objectContaining({ label: 'Update now', onClick: expect.any(Function) }));
  });

  it.each([
    ['/assets/index-current.js', '1.0.1', 'An app update is available (v1.0.1).'],
    ['/assets/index-next.js', '1.0.0', 'An app update is available (v1.0.0).'],
    ['/assets/index-old.js', '0.9.0', 'An app update is available (v0.9.0).'],
    ['/assets/index-old.js', undefined, 'An app update is available.'],
  ])('detects a changed version, rebuilt bundle, or rollback', async (script, version, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(html(script, version))));

    await act(async () => { render(<UpdateChecker />); });

    expect(showToast).toHaveBeenCalledWith(message, 'default', 0, expect.any(Object));
  });

  it('retries after a failed check', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(response(html('/assets/index-next.js', '1.0.1'))));

    await act(async () => { render(<UpdateChecker />); });
    expect(showToast).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
