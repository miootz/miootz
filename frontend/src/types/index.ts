export type Specialty = 'ATT' | 'MID' | 'DEF' | 'GK';

export interface User {
  id: string;
  name: string;
  skillScore: number;
  isLocked: boolean;
  /** Resolved `/uploads/...` URL when the server provided a profile picture. */
  avatarUrl?: string;
  /** Roster attendance row status (non-cancelled attendees only). */
  attendanceStatus?: 'confirmed' | 'waitlisted';
  /** True when this user is a plus-one guest reservation. */
  isPlusOne?: boolean;
  /** Primary playing position. */
  primarySpecialty?: Specialty | null;
  /** Secondary playing position. */
  secondarySpecialty?: Specialty | null;
  /** Assigned pitch position (computed from specialty + skill priority). */
  pitchPosition?: Specialty;
  /** Computed skill rating from meetup history (1–5). Preferred display value. */
  calculatedSkill?: number | null;
}

export interface ChatMessage {
  id: number;
  user_id: number;
  username: string;
  message: string;
  created_at: string;
  /** User's Pocket ID profile-picture URL. */
  avatar_url?: string | null;
  /** Hex color assigned to the user for chat bubbles. */
  username_color?: string | null;
}

export interface Team {
  id: string;
  name: string;
  players: User[];
}

export type MyAttendanceStatus = 'confirmed' | 'waitlisted' | 'cancelled';

export type TeamAssignmentMode = 'balanced' | 'random';

export interface Meetup {
  id: string;
  date: string;
  /** Raw meetup `start_time` from the API (for countdown, weather). */
  startTime?: string;
  attendance: User[];
  teams: Team[];
  location?: string;
  /** From meetup detail when coordinates are set (map + precise directions). */
  latitude?: number | null;
  longitude?: number | null;
  fee?: number;
  /** Free-text price label (e.g. "8 credits") — shown instead of the numeric fee. */
  fee_text?: string | null;
  minPlayers?: number;
  maxPlayers?: number;
  /** From GET /meetups/:id — how server builds teams. */
  teamAssignmentMode?: TeamAssignmentMode;
  /** Set when the viewer is logged in (from GET /meetups/:id). */
  myAttendance?: MyAttendanceStatus | null;
  /** 1-based waitlist position when the viewer is waitlisted. */
  myWaitlistPosition?: number | null;
  /** The viewer's unused Weather Hero awards (from GET /meetups/:id). */
  myWeatherHeroUnused?: number | null;
  /** Live match summaries when the viewer is on the matches surface. */
  matches?: MatchSummary[];
}

export interface MatchSummary {
  matchId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  notes: string;
}
