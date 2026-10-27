import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstallAppBanner } from './InstallAppBanner';
import { OverlayLockProvider } from '../context/OverlayLock';

vi.mock('../offline/engagement', () => ({
  getMeetupViewCount: () => 1,
  engagementChangedEventName: 'engagement-changed',
}));

vi.mock('../utils/pwaDetect', () => ({
  isDisplayModeStandalone: () => false,
  isIosSafari: () => true,
}));

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
});

function renderBanner() {
  return render(
    <OverlayLockProvider>
      <InstallAppBanner />
    </OverlayLockProvider>,
  );
}

describe('InstallAppBanner', () => {
  beforeEach(() => {
    document.title = 'test';
  });

  it('acquires the overlay lock and renders the banner', async () => {
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText('Install Miootz')).toBeInTheDocument();
    });
  });

  it('does not render when dismissed', async () => {
    render(
      <OverlayLockProvider>
        <InstallAppBanner />
      </OverlayLockProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Install Miootz')).toBeInTheDocument();
    });

    // Click the X dismiss button
    const dismissBtns = screen.getAllByRole('button', { name: 'Dismiss' });
    dismissBtns[0].click();

    await waitFor(() => {
      expect(screen.queryByText('Install Miootz')).not.toBeInTheDocument();
    });
  });
});
