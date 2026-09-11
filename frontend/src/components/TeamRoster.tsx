import type { User } from "../types";
import { PlayerAvatarFace } from "./PlayerAvatar";
import { StarRating } from "./StarRating";
import { Lock } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────

/** Format the display rating: calculatedSkill (1dp) or skillScore (int). */
function formatRating(player: User): string {
    if (player.calculatedSkill != null && player.calculatedSkill > 0) {
        return player.calculatedSkill.toFixed(1);
    }
    return String(Math.round(player.skillScore));
}

/** Format position labels: "(DEF/MID)", "(GK)", etc. */
function formatPositions(player: User): string {
    const parts: string[] = [];
    if (player.primarySpecialty) parts.push(player.primarySpecialty);
    if (
        player.secondarySpecialty &&
        player.secondarySpecialty !== player.primarySpecialty
    ) {
        parts.push(player.secondarySpecialty);
    }
    return parts.length > 0 ? `(${parts.join("/")})` : "";
}

// ── Player row ─────────────────────────────────────────────────────

function PlayerRow({
    player,
    ratingMode,
    currentRating,
    onRatingChange,
}: {
    player: User;
    ratingMode: "none" | "popover" | "inline";
    currentRating: number | null;
    onRatingChange?: (score: number) => void;
}) {
    const rating = formatRating(player);
    const positions = formatPositions(player);

    return (
        <div className="flex items-center gap-2.5 px-3 py-2">
            {/* Profile picture */}
            <div className="relative shrink-0">
                <PlayerAvatarFace
                    name={player.name}
                    avatarUrl={player.avatarUrl}
                    size="sm"
                    isPlusOne={player.isPlusOne}
                />
                {/* Locked badge */}
                {player.isLocked && (
                    <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-violet-500 flex items-center justify-center shadow">
                        <Lock size={9} className="text-white" />
                    </div>
                )}
            </div>

            {/* Name + position */}
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {player.name}
                </span>
                {positions && (
                    <span className="text-2xs text-gray-500 dark:text-gray-400 shrink-0">
                        {positions}
                    </span>
                )}
            </div>

            {/* Inline star rating (when allowed) */}
            {ratingMode === "inline" && (
                <div className="shrink-0">
                    <StarRating
                        value={currentRating ?? 0}
                        onChange={onRatingChange}
                        size={14}
                    />
                </div>
            )}

            {/* Computed rating in bold */}
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums shrink-0">
                {rating}
            </span>
        </div>
    );
}

// ── Public component ───────────────────────────────────────────────

export function TeamRoster({
    players,
    onPlayerTap: _onPlayerTap,
    ratingMode = "none",
    ratingScores,
    onRatingChange,
    droppable,
}: {
    players: User[];
    /** Called when a player chip is tapped (for popover rating). */
    onPlayerTap?: (
        player: User,
        event: React.MouseEvent | React.TouchEvent,
    ) => void;
    /** How to display star ratings. */
    ratingMode?: "none" | "popover" | "inline";
    /** Player id → current star rating from the viewer. */
    ratingScores?: Record<string, number | null>;
    /** Called when an inline star rating changes. */
    onRatingChange?: (playerId: string, score: number) => void;
    /** Droppable container props from dnd-kit (optional). */
    droppable?: {
        setNodeRef: (el: HTMLElement | null) => void;
        isOver: boolean;
    };
}) {
    if (players.length === 0) {
        return (
            <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-6 text-center">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                    No players yet
                </span>
            </div>
        );
    }

    return (
        <div
            ref={droppable?.setNodeRef}
            className={`rounded-xl overflow-hidden border transition-colors bg-white dark:bg-gray-900 ${
                droppable?.isOver
                    ? "border-violet-400 ring-2 ring-violet-400/40 dark:ring-violet-500/40"
                    : "border-gray-200 dark:border-gray-800"
            }`}
        >
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {players.map((player) => (
                    <PlayerRow
                        key={player.id}
                        player={player}
                        ratingMode={
                            ratingMode === "inline" &&
                            !Object.hasOwn(ratingScores ?? {}, player.id)
                                ? "none"
                                : ratingMode
                        }
                        currentRating={ratingScores?.[player.id] ?? null}
                        onRatingChange={
                            onRatingChange
                                ? (score) => onRatingChange(player.id, score)
                                : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
}
