import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  ClipboardList,
  LayoutGrid,
  Loader2,
  Search,
  Settings2,
  Share2,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  fetchSessionDetail,
  fetchSessionTeams,
  type SessionDetail,
} from '../../api/sessionsApi';
import {
  adminMoveAttendance,
  adminReshuffleTeams,
  adminSetUserSelfAssessedSkill,
  adminUpdateSession,
  type TeamAssignmentMode,
  type WaitlistMode,
} from '../../api/adminApi';
import { AdminBreadcrumb } from '../../components/admin/AdminBreadcrumb';
import { PlayerAvatarFace, SkillBadge } from '../../components/PlayerAvatar';
import { useToast } from '../../context/ToastContext';
import {
  parseSessionStart,
  sessionStartToDatetimeLocalValue,
} from '../../utils/datetime';
import { hapticLight } from '../../utils/haptics';
import { shareMeetup } from '../../utils/share';
import { MeetupWeatherBadge } from '../../components/MeetupWeatherBadge';

export function AdminSessionDetailPage() {
  const { showToast } = useToast();
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
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>('balanced');

  const [savingMeta, setSavingMeta] = useState(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'attendance' | 'teams'>('details');
  const [attFilter, setAttFilter] = useState<
    'all' | 'confirmed' | 'waitlisted' | 'cancelled'
  >('all');
  const [attSearch, setAttSearch] = useState('');
  const [teamsData, setTeamsData] = useState<Awaited<
    ReturnType<typeof fetchSessionTeams>
  > | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [reshuffling, setReshuffling] = useState(false);
  const [skillBusy, setSkillBusy] = useState<number | null>(null);

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
      setTeamMode(d.team_assignment_mode === 'random' ? 'random' : 'balanced');
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
        team_assignment_mode: teamMode,
      });
      await load();
      showToast('Session updated.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingMeta(false);
    }
  }

  async function reshuffleTeams() {
    if (Number.isNaN(id)) return;
    setReshuffling(true);
    setError(null);
    try {
      await adminReshuffleTeams(id);
      await load();
      showToast('Teams reshuffled.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reshuffle failed');
    } finally {
      setReshuffling(false);
    }
  }

  async function setPlayerSkill(userId: number, value: number) {
    setSkillBusy(userId);
    setError(null);
    try {
      await adminSetUserSelfAssessedSkill(userId, value);
      await load();
      showToast('Skill updated.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skill update failed');
    } finally {
      setSkillBusy(null);
    }
  }

  async function moveUser(userId: number, next: 'confirmed' | 'waitlisted') {
    if (Number.isNaN(id)) return;
    setMovingKey(`${userId}-${next}`);
    setError(null);
    try {
      await adminMoveAttendance(id, userId, next);
      await load();
      hapticLight();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setMovingKey(null);
    }
  }

  async function confirmAllWaitlisted() {
    if (!detail || Number.isNaN(id)) return;
    const waiters = detail.attendees.filter((a) => a.status === 'waitlisted');
    if (waiters.length === 0) {
      showToast('No waitlisted players.', 'success');
      return;
    }
    setBulkWorking(true);
    setError(null);
    try {
      for (const a of waiters) {
        await adminMoveAttendance(id, a.user_id, 'confirmed');
      }
      await load();
      showToast(`Confirmed ${waiters.length} player(s).`, 'success');
      hapticLight();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk confirm failed');
    } finally {
      setBulkWorking(false);
    }
  }

  useEffect(() => {
    if (tab !== 'teams' || Number.isNaN(id)) return;
    let cancelled = false;
    setTeamsLoading(true);
    void fetchSessionTeams(id)
      .then((t) => {
        if (!cancelled) setTeamsData(t);
      })
      .catch(() => {
        if (!cancelled) setTeamsData(null);
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, id, detail?.content_revision]);

  const filteredAttendees = useMemo(() => {
    if (!detail) return [];
    const q = attSearch.trim().toLowerCase();
    return detail.attendees.filter((a) => {
      if (attFilter !== 'all' && a.status !== attFilter) return false;
      if (q) {
        const name = (a.full_name || a.username).toLowerCase();
        if (!name.includes(q) && !a.username.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [detail, attFilter, attSearch]);

  if (Number.isNaN(id)) {
    return (
      <p className="text-red-600 dark:text-red-400">Invalid session id.</p>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
        <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-9 w-3/4 max-w-md rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-56 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-32 rounded-2xl bg-gray-200 dark:bg-gray-800" />
        <div className="h-64 rounded-2xl bg-gray-200 dark:bg-gray-800" />
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

  const startDate = parseSessionStart(detail.start_time);
  const kickoffFuture = startDate.getTime() > Date.now();
  const countdown =
    kickoffFuture ? formatDistanceToNow(startDate, { addSuffix: true }) : null;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-8">
      <AdminBreadcrumb
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Sessions', to: '/admin/sessions' },
          { label: detail.location },
        ]}
      />

      <div>
        <Link
          to="/admin/sessions"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-violet-600 mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All sessions
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
              {detail.location}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Session #{detail.id} · {format(startDate, 'EEE d MMM yyyy')} ·{' '}
              {format(startDate, 'HH:mm')}
              {countdown ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {' '}
                  · Kickoff {countdown}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {detail.latitude != null && detail.longitude != null ? (
              <MeetupWeatherBadge
                latitude={detail.latitude}
                longitude={detail.longitude}
                startTime={detail.start_time}
              />
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-2 min-h-[44px] rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-800 shadow-sm hover:bg-violet-50 active:scale-[0.98] transition-colors dark:border-violet-800 dark:bg-gray-900 dark:text-violet-200 dark:hover:bg-violet-950/50"
              onClick={() => {
                hapticLight();
                void shareMeetup({
                  title: 'Footy Legends meetup',
                  text: `${detail.location} · ${format(startDate, 'EEE d MMM HH:mm')}`,
                  url: window.location.origin + '/',
                }).then((ok) =>
                  showToast(
                    ok ? 'Link copied or shared.' : 'Could not share.',
                    ok ? 'success' : 'error'
                  )
                );
              }}
            >
              <Share2 className="w-4 h-4" aria-hidden />
              Share
            </button>
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800 pb-1"
        role="tablist"
        aria-label="Session sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'details'}
          onClick={() => setTab('details')}
          className={`inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === 'details'
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          <Settings2 className="w-4 h-4 shrink-0" aria-hidden />
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'attendance'}
          onClick={() => setTab('attendance')}
          className={`inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
            tab === 'attendance'
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          <ClipboardList className="w-4 h-4 shrink-0" aria-hidden />
          Attendance
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs tabular-nums text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {detail.attendees.length}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'teams'}
          onClick={() => setTab('teams')}
          className={`inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
            tab === 'teams'
              ? 'bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden />
          Teams
        </button>
      </div>

      {error && (
        <div
          className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
          role="status"
        >
          {error}
        </div>
      )}

      {tab === 'details' && (
      <section>
        <h2 className="sr-only">Details</h2>
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
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Team assignment
              </label>
              <select
                value={teamMode}
                onChange={(e) =>
                  setTeamMode(e.target.value as TeamAssignmentMode)
                }
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
              >
                <option value="balanced">Balanced (skill snake)</option>
                <option value="random">Random order (snake)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Random mode allows reshuffling teams without changing the mode.
              </p>
            </div>
          </div>

          {detail?.game_template_id && detail.game_template && (
            <div className="sm:col-span-2 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/20 p-4 space-y-2">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Weekly template
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                This meetup was created from the template below. Edit schedule and
                defaults under Templates — this page is only for this session instance.
              </p>
              <Link
                to={`/admin/game-templates/${detail.game_template_id}`}
                className="inline-flex text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline"
              >
                Open “{detail.game_template.name}”
              </Link>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={savingMeta}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-60"
            >
              {savingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save changes
            </button>
            {teamMode === 'random' && (
              <button
                type="button"
                disabled={reshuffling}
                onClick={() => void reshuffleTeams()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                {reshuffling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Reshuffle teams
              </button>
            )}
          </div>
        </form>
      </section>
      )}

      {tab === 'attendance' && (
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
          <Users className="w-5 h-5 text-violet-600" />
          Attendance
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Move players between confirmed and waitlisted. Cancelled spots require
          the player to rejoin from the app when policy allows.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center mb-4">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <input
              type="search"
              value={attSearch}
              onChange={(e) => setAttSearch(e.target.value)}
              placeholder="Search players…"
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none dark:text-white"
              aria-label="Search attendance"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'All'],
                ['confirmed', 'Confirmed'],
                ['waitlisted', 'Waitlisted'],
                ['cancelled', 'Cancelled'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAttFilter(key)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium min-h-[44px] transition-colors active:scale-[0.98] ${
                  attFilter === key
                    ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={bulkWorking}
            onClick={() => void confirmAllWaitlisted()}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-emerald-600/50 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
          >
            {bulkWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirm all waitlisted
          </button>
        </div>

        <div className="md:hidden space-y-3 mb-4">
          {filteredAttendees.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-6">No matching players.</p>
          ) : (
            filteredAttendees.map((a) => {
              const canMove =
                a.status === 'confirmed' || a.status === 'waitlisted';
              const busy =
                movingKey === `${a.user_id}-confirmed` ||
                movingKey === `${a.user_id}-waitlisted`;
              const displayName = a.full_name || a.username;
              const mmSkill = Math.min(5, Math.max(1, Math.round(a.skill)));
              return (
                <div
                  key={a.user_id}
                  className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <PlayerAvatarFace
                      name={displayName}
                      avatarUrl={a.profile_pic ?? undefined}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {displayName}
                      </div>
                      <div className="text-xs text-gray-500">@{a.username}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <SkillBadge score={mmSkill} size="sm" />
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
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Self skill</label>
                    <select
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 text-sm px-2 py-2"
                      disabled={skillBusy === a.user_id}
                      value={String(
                        a.self_assessed_skill != null &&
                          a.self_assessed_skill >= 1 &&
                          a.self_assessed_skill <= 5
                          ? a.self_assessed_skill
                          : mmSkill
                      )}
                      onChange={(e) =>
                        void setPlayerSkill(a.user_id, Number(e.target.value))
                      }
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  {canMove ? (
                    <div className="flex flex-wrap gap-2">
                      {a.status !== 'confirmed' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void moveUser(a.user_id, 'confirmed')}
                          className="flex-1 min-h-[44px] rounded-lg border border-emerald-600/50 text-emerald-700 dark:text-emerald-400 text-sm font-medium"
                        >
                          Confirm
                        </button>
                      )}
                      {a.status !== 'waitlisted' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void moveUser(a.user_id, 'waitlisted')}
                          className="flex-1 min-h-[44px] rounded-lg border border-amber-600/50 text-amber-800 dark:text-amber-300 text-sm font-medium"
                        >
                          Waitlist
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 shadow-sm hidden md:block transition-colors">
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
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                    Self skill
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
                      colSpan={4}
                      className="py-8 px-4 text-center text-gray-500"
                    >
                      No sign-ups yet.
                    </td>
                  </tr>
                ) : filteredAttendees.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-gray-500">
                      No matching players.
                    </td>
                  </tr>
                ) : (
                  filteredAttendees.map((a) => {
                    const canMove =
                      a.status === 'confirmed' || a.status === 'waitlisted';
                    const busy =
                      movingKey === `${a.user_id}-confirmed` ||
                      movingKey === `${a.user_id}-waitlisted`;
                    const displayName = a.full_name || a.username;
                    const mmSkill = Math.min(5, Math.max(1, Math.round(a.skill)));
                    return (
                      <tr
                        key={a.user_id}
                        className="border-b border-gray-100 dark:border-gray-800/80 last:border-0"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <PlayerAvatarFace
                              name={displayName}
                              avatarUrl={a.profile_pic ?? undefined}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                  {displayName}
                                </span>
                                <SkillBadge score={mmSkill} size="sm" />
                              </div>
                              <div className="text-xs text-gray-500">
                                @{a.username}
                                {a.calculated_skill != null && (
                                  <span> · calc {a.calculated_skill}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top">
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
                        <td className="py-3 px-4 align-top">
                          <select
                            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 text-xs px-2 py-1 max-w-full"
                            disabled={skillBusy === a.user_id}
                            value={String(
                              a.self_assessed_skill != null &&
                                a.self_assessed_skill >= 1 &&
                                a.self_assessed_skill <= 5
                                ? a.self_assessed_skill
                                : mmSkill
                            )}
                            onChange={(e) =>
                              void setPlayerSkill(
                                a.user_id,
                                Number(e.target.value)
                              )
                            }
                            title="Self-assessed skill (updates matchmaking)"
                          >
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4 text-right align-top">
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
      )}

      {tab === 'teams' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-violet-600" />
            Teams
          </h2>
          {teamsLoading ? (
            <div className="flex justify-center py-12 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : !teamsData || teamsData.teams.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
              No team assignments yet — players need to join and teams must be formed for this
              meetup.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {teamsData.teams.map((team, idx) => (
                <div
                  key={team.id}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-violet-50/80 to-white dark:from-violet-950/30 dark:to-gray-900 p-4 shadow-sm transition-colors"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Team {idx + 1}
                  </h3>
                  <ul className="space-y-2">
                    {team.players.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate text-gray-800 dark:text-gray-200">
                          {p.name}
                        </span>
                        <SkillBadge score={Math.round(p.skillScore)} size="sm" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-800 pt-6 transition-colors">
        Data revision #{detail.content_revision}. Updates when you save session details or change
        roster.
      </footer>
    </div>
  );
}
