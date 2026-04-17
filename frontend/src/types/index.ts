export interface User {
  id: string;
  name: string;
  skillScore: number;
  isLocked: boolean;
  /** Resolved `/uploads/...` URL when the server provided a profile picture. */
  avatarUrl?: string;
  /** Roster attendance row status (non-cancelled attendees only). */
  attendanceStatus?: 'confirmed' | 'waitlisted';
}

export interface ChatMessage {
  id: number;
  user_id: number;
  username: string;
  message: string;
  created_at: string;
  /** User's profile picture URL (from User.profile_pic). */
  avatar_url?: string | null;
  /** Hex color assigned to the user for chat bubbles. */
  username_color?: string | null;
}

export interface Team {
  id: string;
  players: User[];
}

export type MyAttendanceStatus = 'confirmed' | 'waitlisted' | 'cancelled';

export type TeamAssignmentMode = 'balanced' | 'random';

export interface Session {
  id: string;
  date: string;
  /** Raw session `start_time` from the API (for countdown, weather). */
  startTime?: string;
  attendance: User[];
  teams: Team[];
  location?: string;
  /** From session detail when coordinates are set (map + precise directions). */
  latitude?: number | null;
  longitude?: number | null;
  fee?: number;
  minPlayers?: number;
  maxPlayers?: number;
  /** From GET /sessions/:id — how server builds teams. */
  teamAssignmentMode?: TeamAssignmentMode;
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
