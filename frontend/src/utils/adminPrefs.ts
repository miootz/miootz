import { roomStorageKey } from './demoRoom';

const PREFIX = 'miootz-admin';

export const ADMIN_MEETUP_DRAFT_KEY = roomStorageKey(`${PREFIX}-meetup-draft-v1`);
export const ADMIN_LAST_LOCATION_KEY = roomStorageKey(`${PREFIX}-last-meetup-location`);
export const ADMIN_LAST_MIN_PLAYERS_KEY = roomStorageKey(`${PREFIX}-last-min-players`);
export const ADMIN_LAST_MAX_PLAYERS_KEY = roomStorageKey(`${PREFIX}-last-max-players`);
export const ADMIN_TOOLS_JOB_HISTORY_KEY = roomStorageKey(`${PREFIX}-tools-job-history-v1`);

export type MeetupDraftPayload = Record<string, unknown>;

export function readMeetupDraft(): MeetupDraftPayload | null {
  try {
    const raw = localStorage.getItem(ADMIN_MEETUP_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MeetupDraftPayload;
  } catch {
    return null;
  }
}

export function writeMeetupDraft(data: MeetupDraftPayload) {
  localStorage.setItem(ADMIN_MEETUP_DRAFT_KEY, JSON.stringify(data));
}

export function clearMeetupDraft() {
  localStorage.removeItem(ADMIN_MEETUP_DRAFT_KEY);
}

export type JobHistoryEntry = {
  id: string;
  at: string;
  label: string;
  detail: string;
};

export function appendJobHistory(entry: Omit<JobHistoryEntry, 'id' | 'at'>) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const at = new Date().toISOString();
  const row: JobHistoryEntry = { id, at, ...entry };
  let list: JobHistoryEntry[] = [];
  try {
    const raw = localStorage.getItem(ADMIN_TOOLS_JOB_HISTORY_KEY);
    if (raw) list = JSON.parse(raw) as JobHistoryEntry[];
  } catch {
    list = [];
  }
  list.unshift(row);
  localStorage.setItem(
    ADMIN_TOOLS_JOB_HISTORY_KEY,
    JSON.stringify(list.slice(0, 50))
  );
  return row;
}

export function readJobHistory(): JobHistoryEntry[] {
  try {
    const raw = localStorage.getItem(ADMIN_TOOLS_JOB_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as JobHistoryEntry[];
  } catch {
    return [];
  }
}
