import { apiFetch, parseApiError } from "./client";

export type Specialty = "ATT" | "MID" | "DEF" | "GK";

export interface MeUser {
    id: number;
    pocket_id_sub: string;
    display_name?: string | null;
    avatar_url?: string | null;
    self_assessed_skill?: number | null;
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
    return path;
}
