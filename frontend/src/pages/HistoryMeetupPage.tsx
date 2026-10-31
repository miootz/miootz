import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fetchMeetupDetail, type MeetupDetail } from "../api/meetupsApi";
import {
  fetchMeetupRankings,
  type RankingRow,
  type RankingSort,
} from "../api/rankingsApi";
import { MeetupDetailPanel } from "../components/MeetupDetailPanel";
import { RankingsTable } from "../components/RankingsTable";
import { parseMeetupStart } from "../utils/datetime";

export function HistoryMeetupPage() {
  const { meetupId } = useParams<{ meetupId: string }>();
  const navigate = useNavigate();
  const id = Number(meetupId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetupDetail | null>(null);

  // Per-meetup top performers (hidden when the meetup has no completed matches).
  const [performers, setPerformers] = useState<RankingRow[] | null>(null);
  const [pSort, setPSort] = useState<RankingSort>("goals");
  const [pOrder, setPOrder] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchMeetupDetail(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load meetup");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Best-effort: a 404 (no completed matches) hides the section entirely.
  useEffect(() => {
    let cancelled = false;
    void fetchMeetupRankings(id)
      .then((res) => {
        if (!cancelled) setPerformers(res.rows);
      })
      .catch(() => {
        if (!cancelled) setPerformers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const sortedPerformers = useMemo(() => {
    if (!performers) return null;
    const rows = [...performers];
    rows.sort((a, b) => {
      const d = a[pSort] - b[pSort];
      if (d !== 0) return pOrder === "desc" ? -d : d;
      return a.user.display_name.localeCompare(b.user.display_name);
    });
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [performers, pSort, pOrder]);

  /* ── Loading ──────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-live" />
      </div>
    );
  }

  /* ── Error / not found ────────────────────────────── */

  if (error || !detail) {
    return (
      <div className="p-4 max-w-2xl mx-auto text-center space-y-4">
        <p className="text-danger">
          {error || "Meetup not found"}
        </p>
        <button
          type="button"
          onClick={() => navigate("/history")}
          className="inline-flex items-center gap-1.5 min-h-[44px] border border-line px-5 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to History
        </button>
      </div>
    );
  }

  /* ── Detail ───────────────────────────────────────── */

  const start = parseMeetupStart(detail.start_time);
  const dateLabel = format(start, "EEEE, d MMMM yyyy");
  const timeLabel = format(start, "HH:mm");

  return (
    <div className="p-3 sm:p-4 max-w-2xl mx-auto space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate("/history")}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-dim hover:text-ink transition-colors min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to History
      </button>

      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-ink">
          {dateLabel}
        </h1>
        <p className="text-sm text-ink-dim mt-0.5">
          {detail.location}
          {detail.fee != null && detail.fee > 0 && (
            <span className="tabular-nums"> · ${detail.fee.toFixed(0)}</span>
          )}
        </p>
      </header>

      {/* Detail panel */}
      <MeetupDetailPanel
        meetupId={id}
        meetupLocation={detail.location}
        meetupTime={timeLabel}
        meetupFee={detail.fee}
      />

      {/* Top performers for this meetup (hidden without completed matches) */}
      {sortedPerformers && sortedPerformers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-ink">Top performers</h2>
          <RankingsTable
            rows={sortedPerformers}
            sort={pSort}
            order={pOrder}
            onSortChange={(s, o) => {
              setPSort(s);
              setPOrder(o);
            }}
            emptyLabel="No ranked players for this meetup."
          />
        </section>
      )}
    </div>
  );
}
