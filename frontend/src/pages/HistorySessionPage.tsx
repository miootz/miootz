import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fetchSessionDetail, type SessionDetail } from "../api/sessionsApi";
import { SessionDetailPanel } from "../components/SessionDetailPanel";
import { parseSessionStart } from "../utils/datetime";

export function HistorySessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const id = Number(sessionId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchSessionDetail(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Loading ──────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-gray-400" />
      </div>
    );
  }

  /* ── Error / not found ────────────────────────────── */

  if (error || !detail) {
    return (
      <div className="p-4 max-w-2xl mx-auto text-center space-y-4">
        <p className="text-red-600 dark:text-red-400">
          {error || "Session not found"}
        </p>
        <button
          type="button"
          onClick={() => navigate("/history")}
          className="inline-flex items-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to History
        </button>
      </div>
    );
  }

  /* ── Detail ───────────────────────────────────────── */

  const start = parseSessionStart(detail.start_time);
  const dateLabel = format(start, "EEEE, d MMMM yyyy");
  const timeLabel = format(start, "HH:mm");

  return (
    <div className="p-3 sm:p-4 max-w-2xl mx-auto space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate("/history")}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to History
      </button>

      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {dateLabel}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {detail.location}
          {detail.fee != null && detail.fee > 0 && (
            <span> · ${detail.fee.toFixed(0)}</span>
          )}
        </p>
      </header>

      {/* Detail panel */}
      <SessionDetailPanel
        sessionId={id}
        sessionLocation={detail.location}
        sessionTime={timeLabel}
        sessionFee={detail.fee}
      />
    </div>
  );
}
