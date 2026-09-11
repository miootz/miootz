import { useEffect, useMemo, useState } from 'react';
import { format, formatDuration, intervalToDuration } from 'date-fns';
import { Calendar, Clock, Share2, Users } from 'lucide-react';
import type { Session } from '../types';
import { parseSessionStart } from '../utils/datetime';
import { shareMeetup } from '../utils/share';
import { useToast } from '../context/ToastContext';
import { hapticLight } from '../utils/haptics';
import { MeetupWeatherBadge } from './MeetupWeatherBadge';
import { teamSkillBalanceSummary } from '../services/teamService';

interface MeetupHeroSectionProps {
  session: Session;
}

export function MeetupHeroSection({ session }: MeetupHeroSectionProps) {
  const { showToast } = useToast();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const kickoff = session.startTime ? parseSessionStart(session.startTime) : null;
  const kickoffValid = Boolean(
    kickoff && !Number.isNaN(kickoff.getTime())
  );

  const countdown = useMemo(() => {
    if (!kickoffValid || !kickoff) return null;
    if (kickoff.getTime() <= now) return 'Started';
    const d = intervalToDuration({ start: now, end: kickoff.getTime() });
    const s = formatDuration(d, {
      delimiter: ', ',
      format: ['days', 'hours', 'minutes'],
    });
    return s || 'Soon';
  }, [kickoff, kickoffValid, now]);

  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(session.teams);
  const balanceHint =
    totals.length > 0
      ? `${totals.map((t, i) => `T${i + 1}: ${t.toFixed(1)}`).join(' vs ')}${maxDiff > 0 ? ` (±${maxDiff.toFixed(1)})` : ''}`
      : null;

  const confirmed = session.attendance.filter(
    (p) => p.attendanceStatus !== 'waitlisted'
  ).length;
  const waitlisted = session.attendance.filter(
    (p) => p.attendanceStatus === 'waitlisted'
  ).length;
  const cap = session.maxPlayers ?? 0;
  const progress =
    cap > 0 ? Math.min(100, Math.round((confirmed / cap) * 100)) : 0;

  const timeLine = kickoffValid
    ? format(kickoff!, 'HH:mm')
    : session.date;

  const onShare = async () => {
    hapticLight();
    const url = window.location.origin + '/';
    const ok = await shareMeetup({
      title: 'Miootz meetup',
      text: `${session.location ?? 'Meetup'} · ${session.date} ${timeLine}`,
      url,
    });
    showToast(ok ? 'Link copied or shared.' : 'Could not share.', ok ? 'success' : 'error');
  };

  return (
    <section className="rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 to-white p-5 text-left shadow-sm dark:border-violet-900/50 dark:from-violet-950/40 dark:to-gray-900/80">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="inline-flex flex-wrap items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <Calendar className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
            <span>
              {kickoffValid
                ? format(kickoff!, 'EEE d MMM')
                : session.date}
            </span>
            <span className="text-violet-600 dark:text-violet-400">·</span>
            <span className="inline-flex items-center gap-1 font-medium">
              <Clock className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              {timeLine}
            </span>
          </p>
          {session.location && (
            <p className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[min(100%,28rem)]">
              {session.location}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void onShare()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-800 shadow-sm hover:bg-violet-50 active:scale-[0.98] dark:border-violet-800 dark:bg-gray-900 dark:text-violet-200 dark:hover:bg-violet-950/50"
        >
          <Share2 className="h-4 w-4" aria-hidden />
          Share
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
        {session.fee != null && session.fee > 0 && (
          <span className="font-medium text-gray-800 dark:text-gray-200">
            ${session.fee.toFixed(0)}
          </span>
        )}
        {countdown && (
          <span className="text-violet-700 dark:text-violet-300 font-medium">
            Kickoff in {countdown}
          </span>
        )}
      </div>

      {session.latitude != null &&
        session.longitude != null &&
        session.startTime && (
          <div className="mt-2">
            <MeetupWeatherBadge sessionId={Number(session.id)} />
          </div>
        )}

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {cap > 0
              ? `${confirmed}/${cap} confirmed${waitlisted ? ` · ${waitlisted} waitlisted` : ''}`
              : `${confirmed} confirmed${waitlisted ? ` · ${waitlisted} waitlisted` : ''}`}
          </span>
          {cap > 0 && (
            <span className="tabular-nums text-gray-500 dark:text-gray-400">
              {progress}%
            </span>
          )}
        </div>
        {cap > 0 && (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            role="progressbar"
            aria-valuenow={confirmed}
            aria-valuemin={0}
            aria-valuemax={cap}
            aria-label="Confirmed players"
          >
            <div
              className="h-full rounded-full bg-violet-600 transition-[width] duration-300 dark:bg-violet-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {balanceHint && (
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-800 dark:text-gray-200">Teams: </span>
          {balanceHint}
          {balanced ? (
            <span className="ml-1 text-emerald-700 dark:text-emerald-400">· Balanced</span>
          ) : (
            <span className="ml-1 text-amber-800 dark:text-amber-300">· Uneven</span>
          )}
        </p>
      )}
    </section>
  );
}
