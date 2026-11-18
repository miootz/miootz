/**
 * Meetup `start_time` from the API is stored as UTC but often serialized without
 * a `Z` suffix (naive datetime). ECMAScript parses ISO strings *without* a zone as
 * **local** wall time, which shifts the instant and makes datetime-local inputs
 * jump (e.g. 8PM → 5PM for UTC−3).
 */
export function parseMeetupStart(iso: string): Date {
  const t = iso.trim();
  if (!t) return new Date(NaN);
  if (/[zZ]$/.test(t)) return new Date(t);
  // +00:00 / -05:00 style
  if (/[+-]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) return new Date(t);
  // Naive UTC from SQLite / FastAPI
  return new Date(`${t}Z`);
}

/** Match controls open 15 minutes before kickoff and lock 15 minutes after the meetup. */
export function matchControlWindow(startTime: string, durationMinutes?: number | null) {
  const start = parseMeetupStart(startTime).getTime();
  return {
    opensAt: start - 15 * 60_000,
    closesAt: start + ((durationMinutes ?? 120) + 15) * 60_000,
  };
}

/** Value for `<input type="datetime-local" />` in the user's local timezone. */
export function meetupStartToDatetimeLocalValue(iso: string): string {
  const d = parseMeetupStart(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
