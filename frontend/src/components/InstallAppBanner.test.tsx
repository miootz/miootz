import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallAppBanner } from './InstallAppBanner';
import { OverlayLockProvider, useOverlayLock } from '../context/OverlayLock';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';

let media: MediaQueryList & { matches: boolean };

function setUserAgent(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

function LockStatus() {
  const { activeId } = useOverlayLock();
  return <span data-testid="lock">{activeId ?? 'unlocked'}</span>;
}

function renderBanner() {
  return render(
    <OverlayLockProvider>
      <InstallAppBanner />
      <LockStatus />
    </OverlayLockProvider>,
  );
}

function dispatchInstallPrompt() {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
  });
  fireEvent(window, event);
  return event;
}

beforeEach(() => {
  media = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList & { matches: boolean };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'standalone');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('InstallAppBanner', () => {
  it('shows the iPhone browser instructions and releases the lock when dismissed', () => {
    setUserAgent(iphone);
    renderBanner();

    expect(screen.getByRole('dialog', { name: 'Install Miootz' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('does not show or lock on an iPhone home screen app', () => {
    setUserAgent(iphone);
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    renderBanner();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('shows the Safari instructions on an iPad using its desktop user agent', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15');
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    renderBanner();
    expect(screen.getByRole('dialog', { name: 'Install Miootz' })).toBeInTheDocument();
  });

  it('does not show or lock on an Android home screen app', () => {
    setUserAgent(android);
    media.matches = true;
    renderBanner();
    dispatchInstallPrompt();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('does not intercept or show the desktop install prompt', () => {
    setUserAgent(desktop);
    renderBanner();
    const event = dispatchInstallPrompt();

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('shows on Android only when the browser can prompt and consumes the event once', () => {
    setUserAgent(android);
    renderBanner();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');

    const event = dispatchInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('releases the overlay when display mode changes to standalone', () => {
    setUserAgent(iphone);
    renderBanner();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    media.matches = true;
    act(() => media.dispatchEvent(new Event('change')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });
});
