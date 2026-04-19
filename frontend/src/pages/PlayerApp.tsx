import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { format, parseISO } from 'date-fns';
import { MeetupDetails } from './MeetupDetails';
import { HistoryPage } from './HistoryPage';
import type { Session, User, Team } from '../types';
import { rebalanceTeams } from '../services/teamService';
import {
  fetchSessions,
  fetchSessionDetail,
  fetchSessionTeams,
  patchSessionTeams,
  sessionDataEventsUrl,
  type SessionDetail,
} from '../api/sessionsApi';
import { mediaUrl } from '../api/meApi';
import { clearSessionChatCache } from '../stores/sessionChatCache';
import { recordSessionView } from '../offline/engagement';
import { loadSessionSnapshot, saveSessionSnapshot } from '../offline/sessionSnapshot';
import { parseSessionStart } from '../utils/datetime';
import { useMemberShell } from '../context/MemberShellContext';
import { MeetupDetailsSkeleton } from '../components/MeetupDetailsSkeleton';
import { useAuth } from '../auth/useAuth';

function mapDetailToSession(detail: SessionDetail, teams: Team[]): Session {
  const start = detail.start_time;
  const date =
    start.length >= 10
      ? start.slice(0, 10)
      : parseSessionStart(start).toISOString().slice(0, 10);
  const attendance: User[] = detail.attendees
    .filter(
      (a: SessionDetail['attendees'][number]) => a.status !== 'cancelled'
    )
    .map((a: SessionDetail['attendees'][number]) => ({
      id: String(a.user_id),
      name: a.full_name || a.username,
      skillScore: Math.round(a.skill),
      isLocked: false,
      avatarUrl: mediaUrl(a.profile_pic ?? undefined),
      attendanceStatus:
        a.status === 'waitlisted' ? 'waitlisted' : 'confirmed',
    }));
  const ma = detail.my_attendance;
  return {
    id: String(detail.id),
    date,
    startTime: start,
    attendance,
    teams,
    location: detail.location,
    latitude: detail.latitude,
    longitude: detail.longitude,
    fee: detail.fee,
    minPlayers: detail.min_players,
    maxPlayers: detail.max_players,
    myAttendance:
      ma === 'confirmed' || ma === 'waitlisted' || ma === 'cancelled'
        ? ma
        : null,
    teamAssignmentMode:
      detail.team_assignment_mode === 'random' ? 'random' : 'balanced',
  };
}

export function PlayerApp() {
  const { memberView, setHeader } = useMemberShell();
  const { me } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [activeSessionNumericId, setActiveSessionNumericId] = useState<
    number | null
  >(null);
  const [rosterChannelLive, setRosterChannelLive] = useState(false);
  const [lastRosterSync, setLastRosterSync] = useState<Date | null>(null);
  const [offlineDataUpdatedAt, setOfflineDataUpdatedAt] = useState<Date | null>(
    null
  );

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
        avatarUrl: mediaUrl(p.profilePic ?? undefined),
      })),
    }));
    const mapped = mapDetailToSession(detail, t);
    setSession(mapped);
    setActiveSessionNumericId(sessionId);
    setLastRosterSync(new Date());
    setOfflineDataUpdatedAt(null);
    void saveSessionSnapshot(mapped);
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const upcomingRes = await fetchSessions({
        status: 'upcoming',
        order: 'asc',
        limit: 50,
      });
      const upcoming = upcomingRes.items;
      if (upcoming.length === 0) {
        await clearSessionChatCache();
        setSession(null);
        setActiveSessionNumericId(null);
        setOfflineDataUpdatedAt(null);
        const anyRes = await fetchSessions({ limit: 1 });
        if (anyRes.total === 0) {
          setError('No sessions yet. Create one in Admin.');
        } else {
          setError(null);
        }
        return;
      }
      await loadSession(upcoming[0].id);
      recordSessionView();
    } catch (e) {
      const offline =
        typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline) {
        const snap = await loadSessionSnapshot();
        if (snap) {
          setSession(snap.session);
          setActiveSessionNumericId(Number.parseInt(snap.session.id, 10));
          setOfflineDataUpdatedAt(new Date(snap.updatedAt));
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, [loadSession]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (activeSessionNumericId == null) {
      setRosterChannelLive(false);
      return;
    }
    const url = sessionDataEventsUrl(activeSessionNumericId);
    const es = new EventSource(url);
    es.onopen = () => setRosterChannelLive(true);
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
        void clearSessionChatCache().then(() => loadInitialData());
      }
    };
    es.onerror = () => {
      setRosterChannelLive(false);
    };
    return () => {
      es.close();
      setRosterChannelLive(false);
    };
  }, [activeSessionNumericId, loadSession, loadInitialData]);

  useEffect(() => {
    if (loading || !session) {
      setHeader(null);
      return;
    }
    let line1: string;
    if (session.startTime) {
      const k = parseSessionStart(session.startTime);
      line1 = Number.isNaN(k.getTime())
        ? session.date
        : format(k, 'EEE d MMM · HH:mm');
    } else {
      try {
        const d = parseISO(session.date);
        line1 = Number.isNaN(d.getTime())
          ? session.date
          : format(d, 'EEE d MMM');
      } catch {
        line1 = session.date;
      }
    }
    setHeader({
      line1,
      line2: session.location || undefined,
    });
    return () => setHeader(null);
  }, [session, loading, setHeader]);

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

  const handleMovePlayer = useCallback(
    async (playerId: string, sourceTeamId: string, destTeamId: string) => {
      if (!session || activeSessionNumericId == null) return;

      const nextTeams = session.teams.map((team) => {
        if (team.id === sourceTeamId) {
          return {
            ...team,
            players: team.players.filter((p) => p.id !== playerId),
          };
        }
        if (team.id === destTeamId) {
          const player = session.attendance.find((p) => p.id === playerId);
          if (!player) return team;
          return { ...team, players: [...team.players, player] };
        }
        return team;
      });
      const nextSession = { ...session, teams: nextTeams };
      setSession(nextSession);

      const payload = nextSession.teams.map((t) => t.players.map((p) => p.id));
      try {
        await patchSessionTeams(activeSessionNumericId, payload);
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : 'Could not save team lineup',
          'error'
        );
        void loadSession(activeSessionNumericId);
      }
    },
    [
      session,
      activeSessionNumericId,
      loadSession,
      showToast,
    ]
  );

  return (
    <>
      <div
        className={memberView === 'details' ? 'block' : 'hidden'}
        aria-hidden={memberView !== 'details'}
      >
        {loading && <MeetupDetailsSkeleton />}
        {error && !loading && (
          <p className="mx-auto max-w-lg p-8 text-center text-amber-700 dark:text-amber-400">
            {error}
          </p>
        )}
        {!loading && !session && !error && (
          <p className="mx-auto max-w-lg p-8 text-center text-gray-600 dark:text-gray-400">
            No upcoming meetup. Past sessions are in History.
          </p>
        )}
        {!loading && session && (
          <MeetupDetails
            session={session}
            onToggleLock={handleToggleLock}
            onMovePlayer={handleMovePlayer}
            canDragTeams={Boolean(me?.is_admin)}
            rosterChannelLive={rosterChannelLive}
            lastRosterSync={lastRosterSync}
            offlineDataUpdatedAt={offlineDataUpdatedAt}
            onRosterUpdated={() =>
              activeSessionNumericId != null &&
              void loadSession(activeSessionNumericId)
            }
          />
        )}
      </div>
      <div
        className={memberView === 'history' ? 'block' : 'hidden'}
        aria-hidden={memberView !== 'history'}
      >
        <HistoryPage />
      </div>
    </>
  );
}
