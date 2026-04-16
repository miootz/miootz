import React, { useState } from 'react';
import type { Session } from '../types';
import { PlayerCard } from '../components/PlayerCard';
import { DraggableTeams } from '../components/DraggableTeams';
import { SessionChat } from '../components/SessionChat';
import { joinSession, leaveSession } from '../api/sessionsApi';

interface MeetupDetailsProps {
  session: Session;
  onToggleLock: (userId: string) => void;
  onMovePlayer: (playerId: string, sourceTeamId: string, destTeamId: string) => void;
  onRosterUpdated?: () => void;
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
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const sid = Number.parseInt(sessionId, 10);

  const run = async (fn: () => Promise<unknown>) => {
    setFeedback(null);
    setBusy(true);
    try {
      await fn();
      onUpdated();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const status = myAttendance ?? null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 p-4 text-center space-y-3 max-w-xl mx-auto">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {status === 'confirmed' && 'You’re confirmed for this meetup.'}
        {status === 'waitlisted' && 'You’re on the waitlist.'}
        {status === 'cancelled' && 'You’re not attending (you can join again).'}
        {status === null && 'You’re not signed up for this meetup yet.'}
      </p>
      {feedback && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {feedback}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {(status === null || status === 'cancelled') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => joinSession(sid))}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {status === 'cancelled' ? 'Join again' : 'Join meetup'}
          </button>
        )}
        {(status === 'confirmed' || status === 'waitlisted') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => leaveSession(sid))}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
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
  onRosterUpdated,
}) => {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Meetup Details</h1>
        <p className="text-gray-500 dark:text-gray-400">{session.date}</p>
        {session.location && (
          <p className="text-gray-600 dark:text-gray-300">{session.location}</p>
        )}
      </header>

      {onRosterUpdated && (
        <MeetupAttendanceActions
          sessionId={session.id}
          myAttendance={session.myAttendance}
          onUpdated={onRosterUpdated}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Attendance List */}
        <section className="lg:col-span-1 space-y-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 px-2">Attendance</h2>
          <div className="grid gap-3">
            {session.attendance.map(player => (
              <PlayerCard key={player.id} player={player} onToggleLock={onToggleLock} />
            ))}
          </div>
        </section>

        {/* Teams Grid */}
        <section className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 px-2">Teams</h2>
          <DraggableTeams 
            session={session} 
            onToggleLock={onToggleLock} 
            onMovePlayer={onMovePlayer} 
          />
        </section>
      </div>

      {/* Chat Section */}
      <section className="max-w-2xl mx-auto w-full">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 px-2 mb-4">Chat</h2>
        <SessionChat sessionId={session.id} />
      </section>
    </div>
  );
};
