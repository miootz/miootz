import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  adminCreateSession,
  type SessionCreateBody,
  type TeamAssignmentMode,
  type WaitlistMode,
} from '../../api/adminApi';
import { AdminSessionRecurrenceForm } from '../../components/AdminSessionRecurrenceForm';
import { inferRecurrenceWallTime } from '../../utils/recurrence';

function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminSessionNewPage() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startLocal, setStartLocal] = useState(defaultStartLocal);
  const [location, setLocation] = useState('');
  const [fee, setFee] = useState('0');
  const [minPlayers, setMinPlayers] = useState('10');
  const [maxPlayers, setMaxPlayers] = useState('15');
  const [waitlistMode, setWaitlistMode] = useState<WaitlistMode>('auto_promote');
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>('balanced');

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceTz, setRecurrenceTz] = useState(() =>
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'
  );
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [recurrenceHour, setRecurrenceHour] = useState(19);
  const [recurrenceMinute, setRecurrenceMinute] = useState(0);
  const [announceTz, setAnnounceTz] = useState(() =>
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'
  );
  const [announceWeekday, setAnnounceWeekday] = useState(0);
  const [announceHour, setAnnounceHour] = useState(9);
  const [announceMinute, setAnnounceMinute] = useState(0);
  const [sendInviteEmails, setSendInviteEmails] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const min = Number(minPlayers);
    const max = Number(maxPlayers);
    if (Number.isNaN(min) || Number.isNaN(max) || max < min) {
      setError('Max players must be at least min players.');
      return;
    }
    setSaving(true);
    try {
      const body: SessionCreateBody = {
        start_time: new Date(startLocal).toISOString(),
        location: location.trim(),
        fee: Number(fee) || 0,
        min_players: min,
        max_players: max,
        waitlist_mode: waitlistMode,
        team_assignment_mode: teamMode,
        send_invite_emails: sendInviteEmails,
      };
      if (recurrenceEnabled) {
        body.recurrence = {
          enabled: true,
          timezone: recurrenceTz.trim() || 'UTC',
          weekday: recurrenceWeekday,
          hour: recurrenceHour,
          minute: recurrenceMinute,
          announce_timezone: announceTz.trim() || 'UTC',
          announce_weekday: announceWeekday,
          announce_hour: announceHour,
          announce_minute: announceMinute,
        };
      }
      if (!body.location) {
        setError('Location is required.');
        setSaving(false);
        return;
      }
      const created = await adminCreateSession(body);
      const id = (created as { id: number }).id;
      navigate(`/admin/sessions/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create session');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link
        to="/admin/sessions"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-violet-600 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        All sessions
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        New session
      </h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-8">
        Players will see this meetup once it exists; you can edit details later.
      </p>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-5"
      >
        {error && (
          <div
            className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="start"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Start time
          </label>
          <input
            id="start"
            type="datetime-local"
            required
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
        </div>

        <div>
          <label
            htmlFor="loc"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Location
          </label>
          <input
            id="loc"
            type="text"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Pitch address or venue name"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="minp"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Min players
            </label>
            <input
              id="minp"
              type="number"
              min={1}
              max={50}
              value={minPlayers}
              onChange={(e) => setMinPlayers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label
              htmlFor="maxp"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Max players
            </label>
            <input
              id="maxp"
              type="number"
              min={1}
              max={50}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="fee"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Fee
          </label>
          <input
            id="fee"
            type="number"
            min={0}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="wl"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Waitlist mode
          </label>
          <select
            id="wl"
            value={waitlistMode}
            onChange={(e) =>
              setWaitlistMode(e.target.value as WaitlistMode)
            }
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100"
          >
            <option value="auto_promote">Auto-promote from waitlist</option>
            <option value="broadcast">Broadcast only (manual)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="team-mode"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Team assignment
          </label>
          <select
            id="team-mode"
            value={teamMode}
            onChange={(e) =>
              setTeamMode(e.target.value as TeamAssignmentMode)
            }
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100"
          >
            <option value="balanced">Balanced (skill snake)</option>
            <option value="random">Random order (snake)</option>
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Stored on this session and on the recurrence rule when weekly repeat is
            enabled (future instances copy it).
          </p>
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

        <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/40 px-3 py-3">
          <input
            type="checkbox"
            checked={sendInviteEmails}
            onChange={(e) => setSendInviteEmails(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              Email all players
            </span>
            <span className="block text-gray-600 dark:text-gray-400 mt-0.5">
              Send join links (confirm / cancel) to everyone with an email — same
              as automated recurring announcements.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            Create session
          </button>
          <Link
            to="/admin/sessions"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
