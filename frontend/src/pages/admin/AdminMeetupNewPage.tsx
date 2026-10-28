import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  adminCreateMeetup,
  type MeetupCreateBody,
  type TeamAssignmentMode,
  type WaitlistMode,
} from '../../api/adminApi';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { LocationPicker, type GeoPoint } from '../../components/admin/LocationPicker';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import {
  ADMIN_LAST_LOCATION_KEY,
  ADMIN_LAST_MAX_PLAYERS_KEY,
  ADMIN_LAST_MIN_PLAYERS_KEY,
  clearMeetupDraft,
  readMeetupDraft,
  writeMeetupDraft,
} from '../../utils/adminPrefs';

function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Step = 1 | 2;

export function AdminMeetupNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startLocal, setStartLocal] = useState(defaultStartLocal);
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<GeoPoint | null>(null);
  const [fee, setFee] = useState('0');
  const [minPlayers, setMinPlayers] = useState('10');
  const [maxPlayers, setMaxPlayers] = useState('15');
  const [waitlistMode, setWaitlistMode] = useState<WaitlistMode>('auto_promote');
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>('balanced');
  const [sendPushNotifs, setSendPushNotifs] = useState(true);

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
    const draft = readMeetupDraft();
    if (draft && typeof draft === 'object') {
      if (typeof draft.startLocal === 'string') setStartLocal(draft.startLocal);
      if (typeof draft.location === 'string') setLocation(draft.location);
      if (
        typeof draft.latitude === 'number' &&
        typeof draft.longitude === 'number'
      ) {
        setCoords({ lat: draft.latitude, lng: draft.longitude });
      }
      if (typeof draft.fee === 'string') setFee(draft.fee);
      if (typeof draft.minPlayers === 'string') setMinPlayers(draft.minPlayers);
      if (typeof draft.maxPlayers === 'string') setMaxPlayers(draft.maxPlayers);
      if (draft.waitlistMode === 'broadcast' || draft.waitlistMode === 'auto_promote')
        setWaitlistMode(draft.waitlistMode);
      if (draft.teamMode === 'random' || draft.teamMode === 'balanced')
        setTeamMode(draft.teamMode);
      if (typeof draft.step === 'number' && draft.step >= 1 && draft.step <= 2)
        setStep(draft.step as Step);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      writeMeetupDraft({
        startLocal,
        location,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        fee,
        minPlayers,
        maxPlayers,
        waitlistMode,
        teamMode,
        step,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    startLocal,
    location,
    coords,
    fee,
    minPlayers,
    maxPlayers,
    waitlistMode,
    teamMode,
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
      const body: MeetupCreateBody = {
        start_time: new Date(startLocal).toISOString(),
        location: location.trim(),
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        fee: Number(fee) || 0,
        min_players: min,
        max_players: max,
        waitlist_mode: waitlistMode,
        team_assignment_mode: teamMode,
        send_push_notifications: sendPushNotifs,
      };
      if (!body.location) {
        setError('Location is required.');
        setSaving(false);
        return;
      }
      const created = await adminCreateMeetup(body);
      const sid = (created as { id: number }).id;
      try {
        localStorage.setItem(ADMIN_LAST_LOCATION_KEY, location.trim());
        localStorage.setItem(ADMIN_LAST_MIN_PLAYERS_KEY, String(min));
        localStorage.setItem(ADMIN_LAST_MAX_PLAYERS_KEY, String(max));
      } catch {
        /* ignore */
      }
      clearMeetupDraft();
      navigate(`/admin/meetups/${sid}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create meetup');
    } finally {
      setSaving(false);
    }
  }

  const stepper = (
    <div className="flex items-center gap-2 text-sm text-ink-dim mb-6">
      {[1, 2].map((n) => (
        <div key={n} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep(n as Step)}
            className={`flex h-9 w-9 items-center justify-center text-sm font-semibold transition-colors ${
              step === n
                ? 'bg-ink text-board'
                : 'bg-raised text-ink-dim'
            }`}
          >
            {n}
          </button>
          {n < 2 ? <ChevronRight className="h-4 w-4 opacity-50" /> : null}
        </div>
      ))}
      <span className="ml-2 hidden sm:inline">
        {step === 1 ? 'Basics' : 'Review'}
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
              { label: 'Meetups', to: '/admin/meetups' },
              { label: 'One-off meetup' },
            ]}
          />
        }
        title="One-off meetup"
      />

      <Link
        to="/admin/meetups"
        className="inline-flex items-center gap-2 text-sm text-ink-dim hover:text-ink mb-6 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-live transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        All meetups
      </Link>

      {stepper}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="border border-line bg-panel p-6 space-y-5 transition-colors"
      >
        {error && (
          <div
            className="border border-danger/40 bg-danger/15 px-3 py-2 text-sm text-danger"
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
                className="border border-line px-3 py-2 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
                onClick={() => applyPreset('weekday_evening')}
              >
                Weekday evening (~7 PM)
              </button>
              <button
                type="button"
                className="border border-line px-3 py-2 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
                onClick={() => applyPreset('weekend_morning')}
              >
                Weekend morning (~10 AM)
              </button>
            </div>
            <div>
              <label
                htmlFor="start"
                className="block text-xs font-medium text-ink-dim mb-1"
              >
                Start time
              </label>
              <input
                id="start"
                type="datetime-local"
                required
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="loc"
                className="block text-xs font-medium text-ink-dim mb-1"
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
                className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-dim mb-1">
                Venue coordinates <span className="text-ink-faint">(optional)</span>
              </label>
              <LocationPicker value={coords} onChange={setCoords} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="minp"
                  className="block text-xs font-medium text-ink-dim mb-1"
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
                  className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
                />
              </div>
              <div>
                <label
                  htmlFor="maxp"
                  className="block text-xs font-medium text-ink-dim mb-1"
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
                  className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="fee"
                className="block text-xs font-medium text-ink-dim mb-1"
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
                className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="wl"
                className="block text-xs font-medium text-ink-dim mb-1"
              >
                Waitlist mode
              </label>
              <select
                id="wl"
                value={waitlistMode}
                onChange={(e) =>
                  setWaitlistMode(e.target.value as WaitlistMode)
                }
                className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
              >
                <option value="auto_promote">Auto-promote from waitlist</option>
                <option value="broadcast">Broadcast only (manual)</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="team-mode"
                className="block text-xs font-medium text-ink-dim mb-1"
              >
                Team assignment
              </label>
              <select
                id="team-mode"
                value={teamMode}
                onChange={(e) =>
                  setTeamMode(e.target.value as TeamAssignmentMode)
                }
                className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live transition-colors"
              >
                <option value="balanced">Balanced (skill snake)</option>
                <option value="random">Random order (snake)</option>
              </select>
            </div>
            <button
              type="button"
              className="w-full min-h-[44px] bg-ink text-board font-bold hover:bg-white/90 active:scale-[0.98] transition-colors"
              onClick={() => setStep(2)}
            >
              Next: review
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="bg-raised p-4 text-sm text-ink-dim space-y-2 border border-line">
              <p>
                <span className="font-medium text-ink">When:</span>{' '}
                {startLocal.replace('T', ' ')}
              </p>
              <p>
                <span className="font-medium text-ink">Where:</span>{' '}
                {location || '—'}
              </p>
              <p>
                <span className="font-medium text-ink">Players:</span>{' '}
                {minPlayers}–{maxPlayers} · Fee {fee}
              </p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer border border-line bg-raised/50 px-3 py-3 transition-colors">
              <input
                type="checkbox"
                checked={sendPushNotifs}
                onChange={(e) => setSendPushNotifs(e.target.checked)}
                className="mt-0.5 border-line text-team-a focus:ring-2 focus:ring-live"
              />
              <span className="text-sm text-ink">
                <span className="font-medium text-ink">
                  Notify all players
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                className="flex-1 min-h-[44px] border border-line py-2.5 font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 bg-ink text-board font-bold hover:bg-white/90 disabled:opacity-60 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create meetup
              </button>
            </div>
            <Link
              to="/admin/meetups"
              className="block text-center text-sm text-ink-dim hover:text-ink"
            >
              Cancel
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
