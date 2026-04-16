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

export interface Session {
  id: string;
  date: string;
  attendance: User[];
  teams: Team[];
  location?: string;
  fee?: number;
  minPlayers?: number;
  maxPlayers?: number;
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
