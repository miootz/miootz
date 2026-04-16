const base = () => (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export interface SessionListItem {
  id: number;
  start_time: string;
  location: string;
  fee: number;
  min_players: number;
  max_players: number;
  latitude: number | null;
  longitude: number | null;
  waitlist_mode: string;
}

export interface SessionDetail extends SessionListItem {
  attendees: {
    user_id: number;
    username: string;
    full_name: string | null;
    status: string;
    joined_at: string | null;
    skill: number;
  }[];
}

export interface TeamsResponse {
  session_id: number;
  teams: {
    id: string;
    players: {
      id: string;
      name: string;
      skillScore: number;
      isLocked: boolean;
    }[];
  }[];
}

export async function fetchSessions(): Promise<SessionListItem[]> {
  const r = await fetch(`${base()}/sessions/`);
  if (!r.ok) throw new Error(`Sessions ${r.status}`);
  return r.json();
}

export async function fetchSessionDetail(id: number): Promise<SessionDetail> {
  const r = await fetch(`${base()}/sessions/${id}`);
  if (!r.ok) throw new Error(`Session ${r.status}`);
  return r.json();
}

export async function fetchSessionTeams(id: number): Promise<TeamsResponse> {
  const r = await fetch(`${base()}/sessions/${id}/teams`);
  if (!r.ok) throw new Error(`Teams ${r.status}`);
  return r.json();
}
