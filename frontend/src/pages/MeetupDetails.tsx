import React, { useContext, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, MapPin, MessageSquare, Play, Trophy, Users } from 'lucide-react';
import type { Session } from '../types';
import { AuthContext } from '../auth/auth-context';
import { DraggableTeams } from '../components/DraggableTeams';
import { MatchHistoryList } from '../components/MatchHistoryList';
import { SessionChat } from '../components/SessionChat';
import { MeetupLocationSection } from '../components/MeetupLocationSection';
import { LiveMatchBanner } from '../components/LiveMatchBanner';
import { SuccessCheckLottie } from '../components/SuccessCheckLottie';
import { addPlusOne, joinSession, leaveSession } from '../api/sessionsApi';
import { startMatches } from '../api/matchesApi';
import { useToast } from '../context/ToastContext';
import { hapticError, hapticSuccess } from '../utils/haptics';
import { Radio, UserPlus, X } from 'lucide-react';
import { StarRating } from '../components/StarRating';

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
  /** Server-sent events channel open - roster updates apply in real time. */
  rosterChannelLive?: boolean;
  /** Last time attendance/teams were loaded from the server. */
  lastRosterSync?: Date | null;
  /** When this meetup was loaded from IndexedDB while offline. */
  offlineDataUpdatedAt?: Date | null;
}

function PlusOneModal({
  sessionId,
  onClose,
  onSuccess,
}: {
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { showToast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [skill, setSkill] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ claim_url: string } | null>(null);
  const sid = Number.parseInt(sessionId, 10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please fill in both names.');
      return;
    }
    setBusy(true);
    try {
      const res = await addPlusOne(sid, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        self_assessed_skill: skill,
      });
      setResult({ claim_url: res.claim_url });
      hapticSuccess();
      showToast(`Plus-one added for ${res.first_name} ${res.last_name}!`, 'success');
      onSuccess();
    } catch (e) {
      hapticError();
      const msg = e instanceof Error ? e.message : 'Failed to add plus-one';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {result ? (
          <div className="text-center space-y-4">
            <div className="text-4xl">🎉</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Plus-one added!
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Share this link so your guest can claim their spot:
            </p>
            <div className="break-all rounded-lg bg-gray-100 dark:bg-gray-800 p-3 text-xs text-gray-700 dark:text-gray-300 font-mono select-all">
              {window.location.origin}{result.claim_url}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <UserPlus className="text-violet-600 dark:text-violet-400" size={20} />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Add a plus-one
              </h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Invite a friend to play with you. They'll receive a link to claim their spot.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    First name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Last name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                    maxLength={80}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Skill level
                </label>
                <StarRating value={skill} onChange={setSkill} size={28} />
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {busy ? 'Adding…' : 'Add plus-one'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
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
  const [showPlusOne, setShowPlusOne] = useState(false);
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
          ? `You're on the waitlist.`
          : `You're on the list for this meetup.`,
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
        wasWait ? `You've left the waitlist.` : `You've left this meetup.`,
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
    <div className="relative text-center space-y-3 max-w-xl mx-auto">
      {celebrate && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/90 dark:bg-gray-900/90">
          <SuccessCheckLottie size={100} />
        </div>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {status === 'confirmed' && `You're confirmed for this meetup.`}
        {status === 'waitlisted' && `You're on the waitlist.`}
        {status === 'cancelled' && `You're not attending (you can join again).`}
        {status == null &&
          `You're not signed up for this meetup yet.`}
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
          <>
            {status === 'confirmed' && (
              <button
                type="button"
                onClick={() => setShowPlusOne(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-[0.98]"
              >
                <UserPlus size={14} />
                Add a plus-one
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void runLeave()}
              className="px-4 py-2 rounded-lg border border-pink-300 dark:border-pink-700 text-sm text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-950/30 disabled:opacity-50 active:scale-[0.98]"
            >
              {status === 'confirmed' ? 'Leave meetup' : 'Leave waitlist'}
            </button>
          </>
        )}
      </div>
      {showPlusOne && (
        <PlusOneModal
          sessionId={sessionId}
          onClose={() => setShowPlusOne(false)}
          onSuccess={() => {
            setShowPlusOne(false);
            onUpdated();
          }}
        />
      )}
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
  const auth = useContext(AuthContext);
  const isAdmin = auth?.me?.is_admin ?? false;
  const navigate = useNavigate();
  const sessionIdNum = Number.parseInt(session.id, 10);

  const [startingMatch, setStartingMatch] = useState(false);

  const handleStartMatches = async () => {
    setStartingMatch(true);
    try {
      const res = await startMatches(sessionIdNum);
      hapticSuccess();
      if (res.status === 'already_started') {
        // Matches already exist — navigate to referee view to start timer.
        navigate(`/session-matches/${sessionIdNum}`);
      } else {
        showToast('Matches started!', 'success');
        onRosterUpdated?.();
      }
    } catch (e) {
      hapticError();
      const msg = e instanceof Error ? e.message : 'Could not start matches';
      showToast(msg, 'error');
    } finally {
      setStartingMatch(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* 1. Join / Leave / Plus-one */}
      {onRosterUpdated && (
        <MeetupAttendanceActions
          sessionId={session.id}
          myAttendance={session.myAttendance}
          onUpdated={onRosterUpdated}
        />
      )}

      {/* 2. Teams */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <Users className="h-5 w-5" aria-hidden />
          Teams
        </h2>
        <DraggableTeams
          session={session}
          onMovePlayer={onMovePlayer}
          onToggleLock={onToggleLock}
          canDragTeams={canDragTeams}
        />
      </section>

      {/* 3. Match results */}
      {!isNaN(sessionIdNum) && (
        <>
          <hr className="border-gray-200 dark:border-gray-800" />
          <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
              <Trophy className="h-5 w-5" aria-hidden />
              Match results
            </h2>
            {isAdmin && (
              <button
                type="button"
                disabled={startingMatch}
                onClick={() => void handleStartMatches()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 active:scale-[0.98] transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                New match
              </button>
            )}
          </div>
          <LiveMatchBanner sessionId={session.id} />
          <MatchHistoryList
            sessionId={sessionIdNum}
            editable={isAdmin}
          />
        </section>
        </>
      )}

      {/* 4. Chat */}
      <>
        <hr className="border-gray-200 dark:border-gray-800" />
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <MessageSquare className="h-5 w-5" aria-hidden />
          Chat
        </h2>
      </>
      <SessionChat sessionId={session.id} />

      {/* 5. Location */}
      <>
        <hr className="border-gray-200 dark:border-gray-800" />
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <MapPin className="h-5 w-5" aria-hidden />
          Location
        </h2>
      </>
      <MeetupLocationSection
        location={session.location}
        latitude={session.latitude}
        longitude={session.longitude}
      />
    </div>
  );
};
