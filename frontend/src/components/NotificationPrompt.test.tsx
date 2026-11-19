import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberNotificationPrompt } from './MemberNotificationPrompt';
import { InstallAppBanner } from './InstallAppBanner';
import { AdminNotificationPrompt } from './admin/AdminNotificationPrompt';
import { OverlayLockProvider, useOverlayLock } from '../context/OverlayLock';
import { ToastProvider } from '../context/ToastContext';
import { subscribeToWebPush } from '../utils/pushSubscription';

vi.mock('../utils/pushSubscription', () => ({
  pushSupported: () => true,
  subscribeToWebPush: vi.fn(),
}));

let notification: { permission: NotificationPermission; requestPermission: ReturnType<typeof vi.fn> };
let permissionStatus: EventTarget;

function LockStatus() {
  const { activeId } = useOverlayLock();
  return <span data-testid="lock">{activeId ?? 'unlocked'}</span>;
}

function renderMember() {
  return render(
    <ToastProvider>
      <OverlayLockProvider>
        <MemberNotificationPrompt />
        <LockStatus />
      </OverlayLockProvider>
    </ToastProvider>,
  );
}

function renderAdmin() {
  return render(<ToastProvider><AdminNotificationPrompt /></ToastProvider>);
}

beforeEach(() => {
  vi.mocked(subscribeToWebPush).mockReset();
  vi.useFakeTimers();
  localStorage.clear();
  notification = { permission: 'default', requestPermission: vi.fn() };
  permissionStatus = new EventTarget();
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('navigator', Object.create(navigator, {
    permissions: { value: { query: vi.fn().mockResolvedValue(permissionStatus) } },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('notification prompts', () => {
  it('closes the member overlay and releases its lock when permission changes', async () => {
    renderMember();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('dialog', { name: 'Enable notifications' })).toBeInTheDocument();

    notification.permission = 'granted';
    act(() => permissionStatus.dispatchEvent(new Event('change')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('does not open when permission is granted before the delay ends', async () => {
    renderMember();
    await act(async () => {});
    notification.permission = 'granted';
    act(() => permissionStatus.dispatchEvent(new Event('change')));
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('lets the install overlay acquire the lock after permission changes', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36',
    });
    Object.defineProperty(navigator, 'platform', { value: 'Linux' });
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
    render(
      <ToastProvider>
        <OverlayLockProvider>
          <InstallAppBanner />
          <MemberNotificationPrompt />
        </OverlayLockProvider>
      </ToastProvider>,
    );
    await act(async () => {});
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('dialog', { name: 'Enable notifications' })).toBeInTheDocument();

    fireEvent(window, Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(),
    }));
    notification.permission = 'granted';
    act(() => permissionStatus.dispatchEvent(new Event('change')));
    expect(screen.getByRole('dialog', { name: 'Install Miootz' })).toBeInTheDocument();
  });

  it('closes as soon as permission is granted, even while subscription is pending', async () => {
    let granted: (() => void) | undefined;
    vi.mocked(subscribeToWebPush).mockImplementation((callback) => {
      granted = callback;
      return new Promise(() => {});
    });
    renderMember();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(8000));
    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    act(() => granted?.());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('lock')).toHaveTextContent('unlocked');
  });

  it('registers from the admin banner and confirms only after the server save', async () => {
    let complete: (result: { ok: boolean }) => void = () => {};
    vi.mocked(subscribeToWebPush).mockImplementation((onGranted) => {
      notification.permission = 'granted';
      onGranted?.();
      return new Promise((resolve) => { complete = resolve; });
    });
    renderAdmin();
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable' })));
    expect(subscribeToWebPush).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.queryByText('Notifications enabled')).not.toBeInTheDocument();
    await act(async () => complete({ ok: true }));
    expect(screen.getByText('Notifications enabled')).toBeInTheDocument();
  });

  it('reports an admin registration failure after the browser grants permission', async () => {
    vi.mocked(subscribeToWebPush).mockImplementation(async (onGranted) => {
      notification.permission = 'granted';
      onGranted?.();
      return { ok: false, reason: 'Could not save subscription on server' };
    });
    renderAdmin();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable' })));
    expect(screen.getByText('Could not save subscription on server')).toBeInTheDocument();
    expect(screen.queryByText('Notifications enabled')).not.toBeInTheDocument();
  });

  it('rechecks permission on focus when querying notifications is unsupported', async () => {
    vi.stubGlobal('navigator', Object.create(navigator, {
      permissions: { value: { query: vi.fn().mockRejectedValue(new Error('unsupported')) } },
    }));
    renderAdmin();
    await act(async () => {});
    notification.permission = 'granted';
    fireEvent.focus(window);
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });
});
