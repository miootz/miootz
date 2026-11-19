import { apiFetch, parseApiError } from "./client";
import { roomPath } from "../utils/demoRoom";

export type Specialty = "ATT" | "MID" | "DEF" | "GK";

export interface MeUser {
    id: number;
    pocket_id_sub: string;
    display_name?: string | null;
    avatar_url?: string | null;
    calculated_skill?: number | null;
    primary_specialty?: Specialty | null;
    secondary_specialty?: Specialty | null;
    is_admin: boolean;
}

export interface MeResponse {
    user: MeUser;
    is_admin: boolean;
    auth_groups: string[];
}

export interface UserStats {
    games_played: number;
    season_games: number;
    average_rating: number;
    total_ratings: number;
    skill_level: number;
    goals: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    wins: number;
    matches: number;
    win_rate: number;
    season_goals: number;
    season_assists: number;
    season_clean_sheets: number;
    season_goals_conceded: number;
    season_wins: number;
    season_losses: number;
    season_matches: number;
    season_win_rate: number;
    season_goal_assists_per_match: number;
    season_penalties_taken: number;
    season_penalties_scored: number;
    season_penalty_conversion_rate: number;
    weather_hero_unused: number;
    attributes: PlayerAttributes | null;
}

export interface PlayerAttributes {
    sho: AttributeEvidence;
    pas: AttributeEvidence & { total_goals: number };
    def: AttributeEvidence;
    pac: number | null;
    dri: number | null;
}

export interface AttributeEvidence {
    score: number | null;
    count: number;
    sample: number;
    meetups: number;
}

export interface UserHistoryItem {
    meetup_id: number;
    start_time: string;
    location: string;
    status: string;
    previous_status: string | null;
    score_team: number | null;
    score_individual: number | null;
    rating_avg: number | null;
    metrics: {
        attendances: number;
        goals: number;
        assists: number;
        clean_sheets: number;
        goals_conceded: number;
        wins: number;
        matches: number;
        win_rate: number;
    };
}

export interface UserHistoryResponse {
    user: MeUser;
    stats: UserStats;
    history: { items: UserHistoryItem[]; total: number };
}

export async function fetchMyHistory(
    userId: number,
    params: { limit?: number; offset?: number },
): Promise<UserHistoryResponse> {
    const q = new URLSearchParams();
    q.set("limit", String(params.limit ?? 25));
    q.set("offset", String(params.offset ?? 0));
    const r = await apiFetch(`/users/${userId}/history?${q.toString()}`);
    if (!r.ok) throw new Error(await parseApiError(r));
    return r.json() as Promise<UserHistoryResponse>;
}

export async function fetchMyStats(): Promise<UserStats> {
    const r = await apiFetch("/users/me/stats");
    if (!r.ok) throw new Error(await parseApiError(r));
    return r.json() as Promise<UserStats>;
}

export async function patchMyProfile(
    body: Record<string, unknown>,
): Promise<void> {
    const r = await apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await parseApiError(r));
}

export interface GameTemplateSubscriptionRow {
    game_template_id: number;
    name: string;
    notifications_enabled: boolean;
}

export async function fetchGameTemplateSubscriptions(): Promise<{
    items: GameTemplateSubscriptionRow[];
}> {
    const r = await apiFetch("/users/me/game-template-subscriptions");
    if (!r.ok) throw new Error(await parseApiError(r));
    return r.json() as Promise<{ items: GameTemplateSubscriptionRow[] }>;
}

export async function patchGameTemplateSubscription(
    templateId: number,
    notifications_enabled: boolean,
): Promise<void> {
    const r = await apiFetch(
        `/users/me/game-template-subscriptions/${templateId}`,
        {
            method: "PATCH",
            body: JSON.stringify({ notifications_enabled }),
        },
    );
    if (!r.ok) throw new Error(await parseApiError(r));
}

// ── Notification preferences ───────────────────────────────────────

export type NotificationCategory =
    | "meetup_invite"
    | "waitlist"
    | "chat"
    | "meetup_cancelled"
    | "kickoff_reminder"
    | "rating_reminder";

export interface NotificationPreferenceRow {
    category: NotificationCategory;
    enabled: boolean;
}

export async function fetchNotificationPreferences(): Promise<{
    items: NotificationPreferenceRow[];
}> {
    const r = await apiFetch("/users/me/notification-preferences");
    if (!r.ok) throw new Error(await parseApiError(r));
    return r.json() as Promise<{ items: NotificationPreferenceRow[] }>;
}

export async function patchNotificationPreference(
    category: NotificationCategory,
    enabled: boolean,
): Promise<void> {
    const r = await apiFetch(`/users/me/notification-preferences/${category}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
    });
    if (!r.ok) throw new Error(await parseApiError(r));
}

/** Same-origin path or absolute URL (e.g. Pocket ID profile picture). */
export function mediaUrl(path: string | null | undefined): string | undefined {
    if (!path) return undefined;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("/api/")) return roomPath(path);
    return path;
}
