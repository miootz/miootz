import { useEffect, useMemo, useState } from "react";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { Clock, Share2 } from "lucide-react";
import type { Meetup } from "../types";
import { parseMeetupStart } from "../utils/datetime";
import { shareMeetup } from "../utils/share";
import { useToast } from "../context/ToastContext";
import { hapticLight } from "../utils/haptics";
import { MeetupWeatherBadge } from "./MeetupWeatherBadge";
import { teamSkillBalanceSummary } from "../services/teamService";

interface MeetupHeroSectionProps {
  meetup: Meetup;
}

/**
 * The pre-kickoff scoreboard band: one painted panel that tells the state of
 * play — when, where, how full, how the teams balance. The big number is the
 * countdown; once the match is live, LiveMatchBanner takes the board.
 */
export function MeetupHeroSection({ meetup }: MeetupHeroSectionProps) {
  const { showToast } = useToast();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const kickoff = meetup.startTime ? parseMeetupStart(meetup.startTime) : null;
  const kickoffValid = Boolean(
    kickoff && !Number.isNaN(kickoff.getTime()),
  );

  const countdown = useMemo(() => {
    if (!kickoffValid || !kickoff) return null;
    if (kickoff.getTime() <= now) return "Started";
    const d = intervalToDuration({ start: now, end: kickoff.getTime() });
    const s = formatDuration(d, {
      delimiter: " ",
      format: ["days", "hours", "minutes"],
    });
    return s || "Soon";
  }, [kickoff, kickoffValid, now]);

  const { totals, balanced, maxDiff } = teamSkillBalanceSummary(meetup.teams);
  const balanceLine =
    totals.length > 0
      ? `T1 ${totals[0].toFixed(1)} · T2 ${totals[1].toFixed(1)}${
          maxDiff > 0 ? ` (±${maxDiff.toFixed(1)})` : ""
        }`
      : null;

  const confirmed = meetup.attendance.filter(
    (p) => p.attendanceStatus !== "waitlisted",
  ).length;
  const waitlisted = meetup.attendance.filter(
    (p) => p.attendanceStatus === "waitlisted",
  ).length;
  const cap = meetup.maxPlayers ?? 0;

  const timeLine = kickoffValid ? format(kickoff!, "HH:mm") : meetup.date;

  const onShare = async () => {
    hapticLight();
    const url = window.location.origin + "/";
    const ok = await shareMeetup({
      title: "Miootz meetup",
      text: `${meetup.location ?? "Meetup"} · ${meetup.date} ${timeLine}`,
      url,
    });
    showToast(
      ok ? "Link copied or shared." : "Could not share.",
      ok ? "success" : "error",
    );
  };

  return (
    <section className="border border-line bg-panel">
      {/* Zone label row */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
          Meetup
          {meetup.location ? ` · ${meetup.location}` : ""}
        </p>
        <button
          type="button"
          onClick={() => void onShare()}
          className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink"
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          Share
        </button>
      </div>

      {/* The board */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 py-4">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight text-ink">
            {kickoffValid ? format(kickoff!, "EEE d MMM") : meetup.date}
            <span className="mx-2 text-ink-faint">·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              {timeLine}
            </span>
          </p>
          {meetup.fee != null && meetup.fee > 0 && (
            <p className="mt-1 text-sm font-medium tabular-nums text-ink-dim">
              ${meetup.fee.toFixed(0)}
            </p>
          )}
        </div>
        {countdown && (
          <div className="text-right">
            <p className="text-4xl font-extrabold leading-none tracking-tight tabular-nums text-ink">
              {countdown}
            </p>
            <p className="mt-1 text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
              to kickoff
            </p>
          </div>
        )}
      </div>

      {meetup.latitude != null &&
        meetup.longitude != null &&
        meetup.startTime && (
          <div className="px-4 pb-3">
            <MeetupWeatherBadge meetupId={Number(meetup.id)} />
          </div>
        )}

      {/* Bottom strip: capacity + balance, tabular */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-sm">
        <span className="tabular-nums font-medium text-ink">
          {cap > 0 ? `${confirmed}/${cap}` : `${confirmed}`} confirmed
          {waitlisted > 0 && (
            <span className="ml-2 text-ink-dim">
              · {waitlisted} waitlisted
            </span>
          )}
        </span>
        {balanceLine && (
          <span className="tabular-nums text-xs text-ink-dim">
            {balanceLine}{" "}
            {balanced ? (
              <span className="font-medium text-team-a">· Balanced</span>
            ) : (
              <span className="font-medium text-live">· Uneven</span>
            )}
          </span>
        )}
      </div>
    </section>
  );
}
