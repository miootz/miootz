import React, { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { Session } from '../types';
import { DraggableTeams } from '../components/DraggableTeams';
import { SessionChat } from '../components/SessionChat';
import { MeetupLocationSection } from '../components/MeetupLocationSection';
import { MeetupHeroSection } from '../components/MeetupHeroSection';
import { SuccessCheckLottie } from '../components/SuccessCheckLottie';
import { joinSession, leaveSession } from '../api/sessionsApi';
import { useToast } from '../context/ToastContext';
import { hapticError, hapticSuccess } from '../utils/haptics';
import { Radio } from 'lucide-react';

interface MeetupDetailsProps {
  session: Session;
  onToggleLock: (userId: string) => void;
  onMovePlayer: (
    playerId: string,
    sourceTeamId: string,
    destTeamId: string
  ) => void | Promise<void>;
  /** Drag-and-drop between team columns (admins only). */
  canDragTeams?: boolean;
  onRosterUpdated?: () => void;
  /** Server-sent events channel open — roster updates apply in real time. */
  rosterChannelLive?: boolean;
  /** Last time attendance/teams were loaded from the server. */
  lastRosterSync?: Date | null;
  /** When this meetup was loaded from IndexedDB while offline. */
  offlineDataUpdatedAt?: Date | null;
}

function MeetupAttendanceActions({
  sessionId,
  myAttendance,
  onUpdated,
}: {
  sessionId: string;
  myAttendance: Session['myAttendance'];
  onUpdated: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [opt, setOpt] = useState<Session['myAttendance'] | undefined>();
  const [celebrate, setCelebrate] = useState(false);
  const sid = Number.parseInt(sessionId, 10);

  const status = opt !== undefined ? opt : myAttendance;

  useEffect(() => {
    setOpt(undefined);
  }, [myAttendance]);

  const runJoin = async () => {
    setFeedback(null);
    setBusy(true);
    setOpt('confirmed');
    try {
      const res = await joinSession(sid);
      const next =
        res.status === 'waitlisted' ? 'waitlisted' : 'confirmed';
      setOpt(next);
      hapticSuccess();
      setCelebrate(true);
      window.setTimeout(() => setCelebrate(false), 2200);
      showToast(
        next === 'waitlisted'
          ? 'You’re on the waitlist.'
          : 'You’re on the list for this meetup.',
        'success'
      );
      onUpdated();
    } catch (e) {
      setOpt(undefined);
      hapticError();
      const msg = e instanceof Error ? e.message : 'Request failed';
      setFeedback(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runLeave = async () => {
    setFeedback(null);
    setBusy(true);
    const wasWait = status === 'waitlisted';
    setOpt(null);
    try {
      await leaveSession(sid);
      hapticSuccess();
      showToast(
        wasWait ? 'You’ve left the waitlist.' : 'You’ve left this meetup.',
        'success'
      );
      onUpdated();
    } catch (e) {
      setOpt(undefined);
      hapticError();
      const msg = e instanceof Error ? e.message : 'Request failed';
      setFeedback(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 p-4 text-center space-y-3 max-w-xl mx-auto">
      {celebrate && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/90 dark:bg-gray-900/90">
          <SuccessCheckLottie size={100} />
        </div>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {status === 'confirmed' && 'You’re confirmed for this meetup.'}
        {status === 'waitlisted' && 'You’re on the waitlist.'}
        {status === 'cancelled' && 'You’re not attending (you can join again).'}
        {status == null &&
          'You’re not signed up for this meetup yet.'}
      </p>
      {feedback && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {feedback}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {(status == null || status === 'cancelled') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runJoin()}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98]"
          >
            {status === 'cancelled' ? 'Join again' : 'Join meetup'}
          </button>
        )}
        {(status === 'confirmed' || status === 'waitlisted') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runLeave()}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 active:scale-[0.98]"
          >
            {status === 'confirmed' ? 'Leave meetup' : 'Leave waitlist'}
          </button>
        )}
      </div>
    </div>
  );
}

export const MeetupDetails: React.FC<MeetupDetailsProps> = ({
  session,
  onToggleLock,
  onMovePlayer,
  canDragTeams = false,
  onRosterUpdated,
  rosterChannelLive = false,
  lastRosterSync = null,
  offlineDataUpdatedAt = null,
}) => {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Meetup Details</h1>
        {offlineDataUpdatedAt && (
          <p className="text-xs text-amber-800 dark:text-amber-300/95 max-w-xl mx-auto">
            Cached meetup · last saved {offlineDataUpdatedAt.toLocaleString()}
          </p>
        )}
        {(rosterChannelLive || lastRosterSync) && (
          <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-emerald-700 dark:text-emerald-400/95">
            {rosterChannelLive && (
              <span className="inline-flex items-center gap-1 font-medium">
                <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden />
                Live updates
              </span>
            )}
            {lastRosterSync && (
              <span className="text-gray-600 dark:text-gray-400">
                Roster synced{' '}
                {formatDistanceToNow(lastRosterSync, { addSuffix: true })}
              </span>
            )}
          </p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
          {session.teamAssignmentMode === 'random'
            ? 'Teams: random draw (same sizes). Admins can reshuffle from the session admin page.'
            : 'Teams: balanced by skill (snake draft).'}
        </p>
      </header>

      <MeetupHeroSection session={session} />

      <MeetupLocationSection
        location={session.location}
        latitude={session.latitude}
        longitude={session.longitude}
      />

      {onRosterUpdated && (
        <MeetupAttendanceActions
          sessionId={session.id}
          myAttendance={session.myAttendance}
          onUpdated={onRosterUpdated}
        />
      )}

      <section className="space-y-6">
        <div className="px-2 space-y-1">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">Teams</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {canDragTeams
              ? 'Drag a player row to move them between teams (on touch: press and hold briefly, then drag). Lineups are saved and synced. Lock pins someone to their current team when rebalancing. Changing team mode or reshuffling (random) clears a custom lineup.'
              : 'Lock pins a player to their team when lineups rebalance; lock state is local until the server refreshes the roster.'}
          </p>
        </div>
        <DraggableTeams
          session={session}
          onMovePlayer={onMovePlayer}
          onToggleLock={onToggleLock}
          canDragTeams={canDragTeams}
        />
      </section>

      <SessionChat sessionId={session.id} />
    </div>
  );
};
