export interface User {
  id: string;
  name: string;
  skillScore: number;
  isLocked: boolean;
}

export interface ChatMessage {
  id: number;
  user_id: number;
  username: string;
  message: string;
  created_at: string;
}

export interface Team {
  id: string;
  players: User[];
}

export type MyAttendanceStatus = 'confirmed' | 'waitlisted' | 'cancelled';

export interface Session {
  id: string;
  date: string;
  attendance: User[];
  teams: Team[];
  location?: string;
  fee?: number;
  minPlayers?: number;
  maxPlayers?: number;
  /** Set when the viewer is logged in (from GET /sessions/:id). */
  myAttendance?: MyAttendanceStatus | null;
}

export interface MatchSummary {
  matchId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  notes: string;
}

export interface GameSession extends Session {
  matches: MatchSummary[];
}
