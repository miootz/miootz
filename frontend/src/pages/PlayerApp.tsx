import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { MeetupDetails } from './MeetupDetails';
import { HistoryPage } from './HistoryPage';
import type { Session, User, Team, GameSession, MatchSummary } from '../types';
import { rebalanceTeams } from '../services/teamService';
import {
  fetchSessions,
  fetchSessionDetail,
  fetchSessionTeams,
  type SessionDetail,
} from '../api/sessionsApi';
import { useAuth } from '../auth/useAuth';
import { setPreferMemberView } from '../auth/memberViewStorage';
import { clearSessionChatCache } from '../stores/sessionChatCache';

const MOCK_HISTORY: GameSession[] = [];

function mapDetailToSession(detail: SessionDetail, teams: Team[]): Session {
  const start = detail.start_time;
  const date =
    start.length >= 10
      ? start.slice(0, 10)
      : new Date(start).toISOString().slice(0, 10);
  const attendance: User[] = detail.attendees
    .filter(
      (a: SessionDetail['attendees'][number]) => a.status !== 'cancelled'
    )
    .map((a: SessionDetail['attendees'][number]) => ({
      id: String(a.user_id),
      name: a.full_name || a.username,
      skillScore: Math.round(a.skill),
      isLocked: false,
    }));
  const ma = detail.my_attendance;
  return {
    id: String(detail.id),
    date,
    attendance,
    teams,
    location: detail.location,
    fee: detail.fee,
    minPlayers: detail.min_players,
    maxPlayers: detail.max_players,
    myAttendance:
      ma === 'confirmed' || ma === 'waitlisted' || ma === 'cancelled'
        ? ma
        : null,
  };
}

export function PlayerApp() {
  const { me, loading: authLoading } = useAuth();
  const isAdmin = Boolean(me?.is_admin);

  const [view, setView] = useState<'details' | 'history'>('details');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<GameSession[]>(MOCK_HISTORY);
  const [activeSessionNumericId, setActiveSessionNumericId] = useState<
    number | null
  >(null);

  const loadSession = useCallback(async (sessionId: number) => {
    const [detail, teamsRes] = await Promise.all([
      fetchSessionDetail(sessionId),
      fetchSessionTeams(sessionId),
    ]);
    const t = teamsRes.teams.map((x) => ({
      id: x.id,
      players: x.players.map((p) => ({
        id: p.id,
        name: p.name,
        skillScore: p.skillScore,
        isLocked: p.isLocked,
      })),
    }));
    const mapped = mapDetailToSession(detail, t);
    setSession(mapped);
    setActiveSessionNumericId(sessionId);
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchSessions();
      if (list.length === 0) {
        clearSessionChatCache();
        setSession(null);
        setActiveSessionNumericId(null);
        setError('No sessions yet. Create one in Admin.');
        return;
      }
      const next = [...list].sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      )[0];
      await loadSession(next.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [loadSession]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (activeSessionNumericId == null) return;
    const es = new EventSource(
      `/api/sessions/${activeSessionNumericId}/data/events`
    );
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as {
        type: string;
        session_id?: number;
      };
      if (
        data.type === 'session_updated' &&
        data.session_id === activeSessionNumericId
      ) {
        void loadSession(activeSessionNumericId);
      }
      if (
        data.type === 'session_deleted' &&
        data.session_id === activeSessionNumericId
      ) {
        clearSessionChatCache();
        void loadInitialData();
      }
    };
    return () => es.close();
  }, [activeSessionNumericId, loadSession, loadInitialData]);

  const handleToggleLock = (userId: string) => {
    if (!session) return;
    const newAttendance = session.attendance.map((u) =>
      u.id === userId ? { ...u, isLocked: !u.isLocked } : u
    );
    const newTeams = rebalanceTeams({
      attendance: newAttendance,
      teams: session.teams,
    });
    setSession({
      ...session,
      attendance: newAttendance,
      teams: newTeams,
    });
  };

  const handleMovePlayer = (
    playerId: string,
    sourceTeamId: string,
    destTeamId: string
  ) => {
    if (!session) return;
    setSession((prev) => {
      if (!prev) return prev;
      const nextTeams = prev.teams.map((team) => {
        if (team.id === sourceTeamId) {
          return {
            ...team,
            players: team.players.filter((p) => p.id !== playerId),
          };
        }
        if (team.id === destTeamId) {
          const player = prev.attendance.find((p) => p.id === playerId);
          if (!player) return team;
          return { ...team, players: [...team.players, player] };
        }
        return team;
      });
      return { ...prev, teams: nextTeams };
    });
  };

  const handleUpdateMatch = (
    sessionId: string,
    matchId: string,
    updates: Partial<MatchSummary>
  ) => {
    setHistory((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              matches: s.matches.map((m) =>
                m.matchId === matchId ? { ...m, ...updates } : m
              ),
            }
          : s
      )
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <nav className="flex flex-wrap justify-center items-center gap-2 sm:gap-4 p-4 border-b border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setView('details')}
          className={`px-4 py-2 rounded-lg transition-colors ${view === 'details' ? 'bg-purple-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
        >
          Meetup Details
        </button>
        <button
          type="button"
          onClick={() => setView('history')}
          className={`px-4 py-2 rounded-lg transition-colors ${view === 'history' ? 'bg-purple-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
        >
          History
        </button>
        {!authLoading && isAdmin && (
          <Link
            to="/admin"
            onClick={() => setPreferMemberView(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-500/50 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          >
            <Shield className="w-4 h-4 shrink-0" aria-hidden />
            Admin
          </Link>
        )}
      </nav>

      <div
        className={view === 'details' ? 'block' : 'hidden'}
        aria-hidden={view !== 'details'}
      >
        {loading && (
          <p className="text-center p-8 text-gray-600 dark:text-gray-400">
            Loading session…
          </p>
        )}
        {error && !loading && (
          <p className="text-center p-8 text-amber-700 dark:text-amber-400 max-w-lg mx-auto">
            {error}
          </p>
        )}
        {!loading && session && (
            <MeetupDetails
              session={session}
              onToggleLock={handleToggleLock}
              onMovePlayer={handleMovePlayer}
              onRosterUpdated={() =>
                activeSessionNumericId != null &&
                void loadSession(activeSessionNumericId)
              }
            />
        )}
      </div>
      <div
        className={view === 'history' ? 'block' : 'hidden'}
        aria-hidden={view !== 'history'}
      >
        <HistoryPage sessions={history} onUpdateMatch={handleUpdateMatch} />
      </div>
    </div>
  );
}
