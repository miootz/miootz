import { useMemo, useState } from "react";
import { ClipboardList, Loader2, Search } from "lucide-react";
import type { MeetupDetail } from "../api/meetupsApi";
import { adminMoveAttendance } from "../api/adminApi";
import { useToast } from "../context/ToastContext";
import { hapticLight } from "../utils/haptics";
import { AttendancePlayerCard } from "./AttendancePlayerCard";

type AttFilter = "all" | "confirmed" | "waitlisted" | "cancelled";

const FILTERS: AttFilter[] = ["all", "confirmed", "waitlisted", "cancelled"];

export function MeetupAttendancePanel({
  meetupId,
  detail,
  onChanged,
}: {
  meetupId: number;
  detail: MeetupDetail;
  /** Parent refetch hook — called after every successful write. */
  onChanged: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [attFilter, setAttFilter] = useState<AttFilter>("all");
  const [attSearch, setAttSearch] = useState("");
  const [movingKey, setMovingKey] = useState<string | null>(null);

  const attCounts = useMemo(() => {
    return {
      all: detail.attendees.length,
      confirmed: detail.attendees.filter((a) => a.status === "confirmed")
        .length,
      waitlisted: detail.attendees.filter((a) => a.status === "waitlisted")
        .length,
      cancelled: detail.attendees.filter((a) => a.status === "cancelled")
        .length,
    };
  }, [detail]);

  const filteredAttendees = useMemo(() => {
    const q = attSearch.trim().toLowerCase();
    return detail.attendees.filter((a) => {
      if (attFilter !== "all" && a.status !== attFilter) return false;
      if (q && !a.display_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [detail, attFilter, attSearch]);

  async function moveUser(userId: number, next: "confirmed" | "waitlisted") {
    setMovingKey(`${userId}-${next}`);
    try {
      await adminMoveAttendance(meetupId, userId, next);
      hapticLight();
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Move failed", "error");
    } finally {
      setMovingKey(null);
    }
  }

  return (
    <section className="border border-line bg-panel overflow-hidden h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <ClipboardList className="w-4 h-4 text-ink-faint" aria-hidden />
        <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
          Attendance
        </h2>
      </header>

      {/* Search + filters */}
      <div className="flex flex-col gap-2 p-3 pb-0">
        <label className="flex items-center gap-2 border border-line bg-raised px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            type="search"
            value={attSearch}
            onChange={(e) => setAttSearch(e.target.value)}
            placeholder="Search players…"
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-faint focus:outline-hidden"
            aria-label="Search attendance"
          />
        </label>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setAttFilter(key)}
              className={`shrink-0 border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                attFilter === key
                  ? "border-live/40 bg-live/15 text-live"
                  : "border-line bg-panel text-ink-dim hover:border-ink-faint"
              }`}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
              <span
                className={`ml-1 text-2xs tabular-nums ${
                  attFilter === key ? "text-live" : "text-ink-faint"
                }`}
              >
                {attCounts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* One card list at every breakpoint */}
      <div className="space-y-2 p-3">
        {filteredAttendees.length === 0 ? (
          <p className="text-center text-sm text-ink-dim py-8">
            No matching players.
          </p>
        ) : (
          filteredAttendees.map((a) => {
            const canMove =
              a.status === "confirmed" || a.status === "waitlisted";
            const busy =
              movingKey === `${a.user_id}-confirmed` ||
              movingKey === `${a.user_id}-waitlisted`;
            return (
              <AttendancePlayerCard
                key={a.attendance_id ?? `${a.user_id}:${a.status}`}
                name={a.display_name}
                avatarUrl={a.avatar_url}
                skill={a.skill}
                primary={a.primary_specialty}
                secondary={a.secondary_specialty}
                isPlusOne={a.is_plus_one}
                status={a.status}
                calculatedSkill={a.calculated_skill}
                action={
                  canMove ? (
                    <div className="flex gap-1.5 shrink-0">
                      {a.status !== "confirmed" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void moveUser(a.user_id, "confirmed")
                          }
                          className="min-h-[36px] px-2.5 border border-team-a/40 text-team-a text-xs font-medium bg-team-a/15 hover:bg-team-a/25 disabled:opacity-50"
                        >
                          {movingKey === `${a.user_id}-confirmed` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            "Confirm"
                          )}
                        </button>
                      )}
                      {a.status !== "waitlisted" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void moveUser(a.user_id, "waitlisted")
                          }
                          className="min-h-[36px] px-2.5 border border-live/40 text-live text-xs font-medium bg-live/15 hover:bg-live/25 disabled:opacity-50"
                        >
                          {movingKey === `${a.user_id}-waitlisted` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            "Waitlist"
                          )}
                        </button>
                      )}
                    </div>
                  ) : undefined
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
