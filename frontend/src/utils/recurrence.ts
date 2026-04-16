/** Python-style weekday: Monday = 0 … Sunday = 6 (matches API). */

const PYTHON_WEEKDAY: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

export const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

/** Wall clock weekday + time in `timeZone` for an instant from `datetime-local` value. */
export function inferRecurrenceWallTime(
  startLocal: string,
  timeZone: string
): { weekday: number; hour: number; minute: number } | null {
  const d = new Date(startLocal);
  if (Number.isNaN(d.getTime())) return null;
  const wd = d.toLocaleDateString('en-US', {
    timeZone,
    weekday: 'long',
  });
  const hm = d.toLocaleTimeString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const weekday = PYTHON_WEEKDAY[wd];
  const [hs, ms] = hm.split(':');
  const hour = parseInt(hs ?? '', 10);
  const minute = parseInt(ms ?? '', 10);
  if (
    weekday === undefined ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }
  return { weekday, hour, minute };
}
