import type { User } from "../types";
import { PlayerAvatarFace } from "./PlayerAvatar";
import { StarRating } from "./StarRating";
import { Lock } from "lucide-react";
import { PlayerEditLink } from "./PlayerEditLink";
import { SkillRating } from "./SkillRating";

// ── Helpers ────────────────────────────────────────────────────────

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
    isMe,
}: {
    player: User;
    ratingMode: "none" | "popover" | "inline";
    currentRating: number | null;
    onRatingChange?: (score: number) => void;
    isMe?: boolean;
}) {
    const positions = formatPositions(player);

    return (
        <div className={`relative flex items-start gap-2.5 px-3 py-2 ${isMe ? "bg-live/10" : ""}`}>
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
                    <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-live flex items-center justify-center">
                        <Lock size={9} className="text-white" />
                    </div>
                )}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">
                        <PlayerEditLink playerId={player.id} className="break-words text-sm font-medium text-ink [overflow-wrap:anywhere]" stretch>
                            {player.name}
                        </PlayerEditLink>
                        {(player.pac ?? 3) > 3 && <span className="text-2xs font-bold text-attribute-pac shrink-0">PAC</span>}
                        {(player.dri ?? 3) > 3 && <span className="text-2xs font-bold text-attribute-dri shrink-0">DRI</span>}
                        {isMe && <span className="text-2xs font-bold text-live shrink-0">You</span>}
                        {positions && <span className="text-2xs text-ink-faint shrink-0">{positions}</span>}
                    </div>
                    <SkillRating score={player.calculatedSkill ?? player.skillScore} className="text-sm text-ink" />
                </div>
                {ratingMode === "inline" && (
                    <div className="relative z-10 mt-1">
                        <StarRating
                            value={currentRating}
                            onChange={onRatingChange}
                            size={20}
                            min={1}
                            label={`Your rating of ${player.name}`}
                        />
                    </div>
                )}
            </div>
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
    currentUserId,
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
    /** Signed-in player's id; their row gets a highlight + "You" chip. */
    currentUserId?: number;
    /** Droppable container props from dnd-kit (optional). */
    droppable?: {
        setNodeRef: (el: HTMLElement | null) => void;
        isOver: boolean;
    };
}) {
    if (players.length === 0) {
        return (
            <div className="border border-line bg-panel px-4 py-6 text-center">
                <span className="text-sm text-ink-faint">
                    No players yet
                </span>
            </div>
        );
    }

    return (
        <div
            ref={droppable?.setNodeRef}
            className={`border transition-colors bg-panel ${
                droppable?.isOver
                    ? "border-live ring-2 ring-live/40"
                    : "border-line"
            }`}
        >
            <div className="divide-y divide-line">
                {players.map((player) => (
                    <PlayerRow
                        key={player.id}
                        player={player}
                        isMe={currentUserId != null && player.id === String(currentUserId)}
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
