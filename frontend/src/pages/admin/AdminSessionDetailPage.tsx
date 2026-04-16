import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Loader2,
  UserCheck,
  Users,
} from 'lucide-react';
import { fetchSessionDetail, type SessionDetail } from '../../api/sessionsApi';
import {
  adminMoveAttendance,
  adminUpdateSession,
  type WaitlistMode,
} from '../../api/adminApi';
import { AdminSessionRecurrenceForm } from '../../components/AdminSessionRecurrenceForm';
import { inferRecurrenceWallTime } from '../../utils/recurrence';
import {
  parseSessionStart,
  sessionStartToDatetimeLocalValue,
} from '../../utils/datetime';

export function AdminSessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const id = sessionId ? parseInt(sessionId, 10) : NaN;

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startLocal, setStartLocal] = useState('');
  const [location, setLocation] = useState('');
  const [fee, setFee] = useState('0');
  const [minPlayers, setMinPlayers] = useState('10');
  const [maxPlayers, setMaxPlayers] = useState('15');
  const [waitlistMode, setWaitlistMode] = useState<WaitlistMode>('auto_promote');

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceTz, setRecurrenceTz] = useState('UTC');
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [recurrenceHour, setRecurrenceHour] = useState(19);
  const [recurrenceMinute, setRecurrenceMinute] = useState(0);
  const [announceTz, setAnnounceTz] = useState('UTC');
  const [announceWeekday, setAnnounceWeekday] = useState(0);
  const [announceHour, setAnnounceHour] = useState(9);
  const [announceMinute, setAnnounceMinute] = useState(0);

  const [savingMeta, setSavingMeta] = useState(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (Number.isNaN(id)) return;
    setError(null);
    try {
      const d = await fetchSessionDetail(id);
      setDetail(d);
      setStartLocal(sessionStartToDatetimeLocalValue(d.start_time));
      setLocation(d.location);
      setFee(String(d.fee));
      setMinPlayers(String(d.min_players));
      setMaxPlayers(String(d.max_players));
      setWaitlistMode(
        d.waitlist_mode === 'broadcast' ? 'broadcast' : 'auto_promote'
      );
      if (d.recurrence) {
        setRecurrenceEnabled(d.recurrence.is_active);
        setRecurrenceTz(d.recurrence.timezone);
        setRecurrenceWeekday(d.recurrence.weekday);
        setRecurrenceHour(d.recurrence.hour);
        setRecurrenceMinute(d.recurrence.minute);
        setAnnounceTz(d.recurrence.announce_timezone);
        setAnnounceWeekday(d.recurrence.announce_weekday);
        setAnnounceHour(d.recurrence.announce_hour);
        setAnnounceMinute(d.recurrence.announce_minute);
      } else {
        setRecurrenceEnabled(false);
        const localTz =
          typeof Intl !== 'undefined'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : 'UTC';
        setRecurrenceTz(localTz);
        const t = inferRecurrenceWallTime(
          sessionStartToDatetimeLocalValue(d.start_time),
          localTz
        );
        if (t) {
          setRecurrenceWeekday(t.weekday);
          setRecurrenceHour(t.hour);
          setRecurrenceMinute(t.minute);
          setAnnounceWeekday(t.weekday);
          setAnnounceHour(t.hour);
          setAnnounceMinute(t.minute);
        }
        setAnnounceTz(localTz);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    if (Number.isNaN(id)) return;
    const min = Number(minPlayers);
    const max = Number(maxPlayers);
    if (max < min) {
      setError('Max players must be ≥ min players.');
      return;
    }
    setSavingMeta(true);
    setError(null);
    try {
      await adminUpdateSession(id, {
        start_time: new Date(startLocal).toISOString(),
        location: location.trim(),
        fee: Number(fee) || 0,
        min_players: min,
        max_players: max,
        waitlist_mode: waitlistMode,
        recurrence: {
          enabled: recurrenceEnabled,
          timezone: recurrenceTz.trim() || 'UTC',
          weekday: recurrenceWeekday,
          hour: recurrenceHour,
          minute: recurrenceMinute,
          announce_timezone: announceTz.trim() || 'UTC',
          announce_weekday: announceWeekday,
          announce_hour: announceHour,
          announce_minute: announceMinute,
        },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingMeta(false);
    }
  }

  async function moveUser(userId: number, next: 'confirmed' | 'waitlisted') {
    if (Number.isNaN(id)) return;
    setMovingKey(`${userId}-${next}`);
    setError(null);
    try {
      await adminMoveAttendance(id, userId, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setMovingKey(null);
    }
  }

  if (Number.isNaN(id)) {
    return (
      <p className="text-red-600 dark:text-red-400">Invalid session id.</p>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-gray-600 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-red-800 dark:text-red-200">
        {error}
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div>
        <Link
          to="/admin/sessions"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-violet-600 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          All sessions
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {detail.location}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Session #{detail.id} ·{' '}
          {format(parseSessionStart(detail.start_time), 'PPp')}
        </p>
      </div>

      {error && (
        <div
          className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
          role="status"
        >
          {error}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Details
        </h2>
        <form
          onSubmit={(e) => void saveMeta(e)}
          className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start time
              </label>
              <input
                type="datetime-local"
                required
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Location
              </label>
              <input
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Min players
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={minPlayers}
                onChange={(e) => setMinPlayers(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max players
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Fee
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Waitlist mode
              </label>
              <select
                value={waitlistMode}
                onChange={(e) =>
                  setWaitlistMode(e.target.value as WaitlistMode)
                }
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
              >
                <option value="auto_promote">Auto-promote</option>
                <option value="broadcast">Broadcast</option>
              </select>
            </div>
          </div>

          <AdminSessionRecurrenceForm
            startLocal={startLocal}
            enabled={recurrenceEnabled}
            onEnabledChange={(v) => {
              setRecurrenceEnabled(v);
              if (v) {
                const t = inferRecurrenceWallTime(startLocal, recurrenceTz);
                if (t) {
                  setRecurrenceWeekday(t.weekday);
                  setRecurrenceHour(t.hour);
                  setRecurrenceMinute(t.minute);
                  setAnnounceWeekday(t.weekday);
                  setAnnounceHour(t.hour);
                  setAnnounceMinute(t.minute);
                }
                setAnnounceTz(recurrenceTz);
              }
            }}
            timezone={recurrenceTz}
            onTimezoneChange={setRecurrenceTz}
            weekday={recurrenceWeekday}
            onWeekdayChange={setRecurrenceWeekday}
            hour={recurrenceHour}
            onHourChange={setRecurrenceHour}
            minute={recurrenceMinute}
            onMinuteChange={setRecurrenceMinute}
            announceTimezone={announceTz}
            onAnnounceTimezoneChange={setAnnounceTz}
            announceWeekday={announceWeekday}
            onAnnounceWeekdayChange={setAnnounceWeekday}
            announceHour={announceHour}
            onAnnounceHourChange={setAnnounceHour}
            announceMinute={announceMinute}
            onAnnounceMinuteChange={setAnnounceMinute}
          />

          <button
            type="submit"
            disabled={savingMeta}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60"
          >
            {savingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save changes
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
          <Users className="w-5 h-5 text-violet-600" />
          Attendance
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Move players between confirmed and waitlisted. Cancelled spots require
          the player to rejoin from the app when policy allows.
        </p>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                    Player
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                    Status
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.attendees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-8 px-4 text-center text-gray-500"
                    >
                      No sign-ups yet.
                    </td>
                  </tr>
                ) : (
                  detail.attendees.map((a) => {
                    const canMove =
                      a.status === 'confirmed' || a.status === 'waitlisted';
                    const busy =
                      movingKey === `${a.user_id}-confirmed` ||
                      movingKey === `${a.user_id}-waitlisted`;
                    return (
                      <tr
                        key={a.user_id}
                        className="border-b border-gray-100 dark:border-gray-800/80 last:border-0"
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {a.full_name || a.username}
                          </div>
                          <div className="text-xs text-gray-500">
                            @{a.username} · skill {Math.round(a.skill)}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              a.status === 'confirmed'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                : a.status === 'waitlisted'
                                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                                  : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {a.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {canMove ? (
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              {a.status !== 'confirmed' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void moveUser(a.user_id, 'confirmed')
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-600/50 text-emerald-700 dark:text-emerald-400 px-2 py-1 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  Confirm
                                </button>
                              )}
                              {a.status !== 'waitlisted' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void moveUser(a.user_id, 'waitlisted')
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-600/50 text-amber-800 dark:text-amber-300 px-2 py-1 text-xs hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50"
                                >
                                  <Users className="w-3.5 h-3.5" />
                                  Waitlist
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
