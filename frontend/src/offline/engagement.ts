const MEETUP_VIEWS_KEY = 'miootz:meetup-views';

const ENGAGEMENT_EVENT = 'miootz-engagement';

/** Increment after a successful meetup meetup load; returns new count. */
export function recordMeetupView(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(MEETUP_VIEWS_KEY) || '0', 10) || 0;
    const next = n + 1;
    localStorage.setItem(MEETUP_VIEWS_KEY, String(next));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ENGAGEMENT_EVENT));
    }
    return next;
  } catch {
    return 0;
  }
}

export function getMeetupViewCount(): number {
  try {
    return Number.parseInt(localStorage.getItem(MEETUP_VIEWS_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export const engagementChangedEventName = ENGAGEMENT_EVENT;

const INSTALL_DISMISSED_KEY = 'miootz:install-prompt-dismissed';

export function isInstallPromptDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}
