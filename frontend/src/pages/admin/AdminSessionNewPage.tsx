import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  adminCreateSession,
  type SessionCreateBody,
  type TeamAssignmentMode,
  type WaitlistMode,
} from '../../api/adminApi';
import { AdminSessionRecurrenceForm } from '../../components/AdminSessionRecurrenceForm';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { inferRecurrenceWallTime } from '../../utils/recurrence';
import {
  ADMIN_LAST_LOCATION_KEY,
  ADMIN_LAST_MAX_PLAYERS_KEY,
  ADMIN_LAST_MIN_PLAYERS_KEY,
  clearSessionDraft,
  readSessionDraft,
  writeSessionDraft,
} from '../../utils/adminPrefs';

function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Step = 1 | 2 | 3;

export function AdminSessionNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
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

  useEffect(() => {
    try {
      const lastLoc = localStorage.getItem(ADMIN_LAST_LOCATION_KEY);
      if (lastLoc) setLocation(lastLoc);
      const min = localStorage.getItem(ADMIN_LAST_MIN_PLAYERS_KEY);
      const max = localStorage.getItem(ADMIN_LAST_MAX_PLAYERS_KEY);
      if (min) setMinPlayers(min);
      if (max) setMaxPlayers(max);
    } catch {
      /* ignore */
    }
    const draft = readSessionDraft();
    if (draft && typeof draft === 'object') {
      if (typeof draft.startLocal === 'string') setStartLocal(draft.startLocal);
      if (typeof draft.location === 'string') setLocation(draft.location);
      if (typeof draft.fee === 'string') setFee(draft.fee);
      if (typeof draft.minPlayers === 'string') setMinPlayers(draft.minPlayers);
      if (typeof draft.maxPlayers === 'string') setMaxPlayers(draft.maxPlayers);
      if (draft.waitlistMode === 'broadcast' || draft.waitlistMode === 'auto_promote')
        setWaitlistMode(draft.waitlistMode);
      if (draft.teamMode === 'random' || draft.teamMode === 'balanced')
        setTeamMode(draft.teamMode);
      if (typeof draft.recurrenceEnabled === 'boolean')
        setRecurrenceEnabled(draft.recurrenceEnabled);
      if (typeof draft.step === 'number' && draft.step >= 1 && draft.step <= 3)
        setStep(draft.step as Step);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      writeSessionDraft({
        startLocal,
        location,
        fee,
        minPlayers,
        maxPlayers,
        waitlistMode,
        teamMode,
        recurrenceEnabled,
        step,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    startLocal,
    location,
    fee,
    minPlayers,
    maxPlayers,
    waitlistMode,
    teamMode,
    recurrenceEnabled,
    step,
  ]);

  function applyPreset(which: 'weekday_evening' | 'weekend_morning') {
    const d = new Date(startLocal);
    if (Number.isNaN(d.getTime())) return;
    if (which === 'weekday_evening') {
      d.setHours(19, 0, 0, 0);
    } else {
      const day = d.getDay();
      const add = (6 - day + 7) % 7 || 7;
      d.setDate(d.getDate() + (day === 0 || day === 6 ? 0 : add));
      d.setHours(10, 0, 0, 0);
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    setStartLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

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
      const sid = (created as { id: number }).id;
      try {
        localStorage.setItem(ADMIN_LAST_LOCATION_KEY, location.trim());
        localStorage.setItem(ADMIN_LAST_MIN_PLAYERS_KEY, String(min));
        localStorage.setItem(ADMIN_LAST_MAX_PLAYERS_KEY, String(max));
      } catch {
        /* ignore */
      }
      clearSessionDraft();
      navigate(`/admin/sessions/${sid}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create session');
    } finally {
      setSaving(false);
    }
  }

  const stepper = (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-6">
      {[1, 2, 3].map((n) => (
        <div key={n} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep(n as Step)}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
              step === n
                ? 'bg-violet-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            }`}
          >
            {n}
          </button>
          {n < 3 ? <ChevronRight className="h-4 w-4 opacity-50" /> : null}
        </div>
      ))}
      <span className="ml-2 hidden sm:inline">
        {step === 1 ? 'Basics' : step === 2 ? 'Settings' : 'Review'}
      </span>
    </div>
  );

  return (
    <div className="max-w-xl mx-auto">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[
              { label: 'Admin', to: '/admin' },
              { label: 'Sessions', to: '/admin/sessions' },
              { label: 'New session' },
            ]}
          />
        }
        title="New session"
        subtitle="Players will see this meetup once it exists; you can edit details later. Draft saves in this browser."
      />

      <Link
        to="/admin/sessions"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-violet-600 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        All sessions
      </Link>

      {stepper}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-5 transition-colors"
      >
        {error && (
          <div
            className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => applyPreset('weekday_evening')}
              >
                Weekday evening (~7 PM)
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => applyPreset('weekend_morning')}
              >
                Weekend morning (~10 AM)
              </button>
            </div>
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
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 transition-colors"
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
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 transition-colors"
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
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 transition-colors"
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
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 transition-colors"
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
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 transition-colors"
              />
            </div>
            <button
              type="button"
              className="w-full min-h-[44px] rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 active:scale-[0.98] transition-colors"
              onClick={() => setStep(2)}
            >
              Next: settings
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
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
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 transition-colors"
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
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 transition-colors"
              >
                <option value="balanced">Balanced (skill snake)</option>
                <option value="random">Random order (snake)</option>
              </select>
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
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="flex-1 min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-600 py-2.5 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <button
                type="button"
                className="flex-1 min-h-[44px] rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 active:scale-[0.98] transition-colors"
                onClick={() => setStep(3)}
              >
                Next: review
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-950/50 p-4 text-sm text-gray-700 dark:text-gray-300 space-y-2 border border-gray-200 dark:border-gray-800">
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">When:</span>{' '}
                {startLocal.replace('T', ' ')}
              </p>
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">Where:</span>{' '}
                {location || '—'}
              </p>
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">Players:</span>{' '}
                {minPlayers}–{maxPlayers} · Fee {fee}
              </p>
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">Weekly:</span>{' '}
                {recurrenceEnabled ? 'Yes' : 'No'}
              </p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/40 px-3 py-3 transition-colors">
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
                  Send join links to everyone with an email.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                className="flex-1 min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-600 py-2.5 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => setStep(2)}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create session
              </button>
            </div>
            <Link
              to="/admin/sessions"
              className="block text-center text-sm text-gray-600 dark:text-gray-400 hover:text-violet-600"
            >
              Cancel
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
