import { useEffect, useState } from "react";
import { Download, Loader2, Play } from "lucide-react";
import { format } from "date-fns";
import { adminRunRecurringNow } from "../../api/adminApi";
import { fetchMeetups } from "../../api/meetupsApi";
import { parseMeetupStart } from "../../utils/datetime";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { useToast } from "../../context/ToastContext";
import {
  appendJobHistory,
  readJobHistory,
  type JobHistoryEntry,
} from "../../utils/adminPrefs";

export function AdminToolsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setHistory(readJobHistory());
  }, []);

  async function runRecurring() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await adminRunRecurringNow();
      const msg = `Checked ${res.templates_checked} template(s); created ${res.meetups_created} new meetup(s).`;
      setMessage(msg);
      showToast(msg, "success");
      appendJobHistory({
        label: "Run recurring jobs now",
        detail: `${res.templates_checked} templates · ${res.meetups_created} meetup(s) created`,
      });
      setHistory(readJobHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Job failed");
    } finally {
      setLoading(false);
    }
  }

  async function exportMeetupsCsv() {
    setExporting(true);
    setError(null);
    try {
      const { items: meetups } = await fetchMeetups({ limit: 500 });
      const headers = [
        "id",
        "start_time",
        "location",
        "fee",
        "min_players",
        "max_players",
        "confirmed_count",
        "waitlist_mode",
      ];
      const lines = [
        headers.join(","),
        ...meetups.map((s) =>
          [
            s.id,
            JSON.stringify(parseMeetupStart(s.start_time).toISOString()),
            JSON.stringify(s.location),
            s.fee,
            s.min_players,
            s.max_players,
            s.confirmed_count ?? 0,
            JSON.stringify(s.waitlist_mode),
          ].join(","),
        ),
      ];
      const blob = new Blob([lines.join("\n")], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `miootz-meetups-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("CSV downloaded.", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-10">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: "Admin", to: "/admin" }, { label: "Tools" }]}
          />
        }
        title="Tools"
      />

      <div className="border border-line bg-panel p-6 transition-colors">
        <h2 className="text-base font-semibold text-ink mb-1">
          Recurring meetups
        </h2>
        <p className="text-sm text-ink-dim mb-6">
          Runs the same logic as each template’s weekly job: create the next
          meetup if missing, then send push notifications with join links. Use
          after downtime or to test your configured announce times.
        </p>

        {error && (
          <div
            className="mb-4 border border-danger/40 bg-danger/15 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {error}
          </div>
        )}
        {message && (
          <div
            className="mb-4 border border-team-a/40 bg-team-a/15 px-3 py-2 text-sm text-team-a"
            role="status"
          >
            {message}
          </div>
        )}

        <button
          type="button"
          onClick={() => void runRecurring()}
          disabled={loading}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 bg-ink text-board font-bold hover:bg-white/90 disabled:opacity-50 active:scale-[0.98] transition-opacity"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run recurring jobs now
        </button>
      </div>

      <div className="border border-line bg-panel p-6 transition-colors">
        <h2 className="text-base font-semibold text-ink mb-1">
          Export data
        </h2>
        <button
          type="button"
          onClick={() => void exportMeetupsCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 border border-line text-ink-dim font-medium hover:bg-raised hover:text-ink disabled:opacity-50 transition-colors"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Export meetups (CSV)
        </button>
      </div>

      <section>
        <h2 className="text-base font-semibold text-ink mb-3">
          Job history
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-dim">
            No manual runs recorded in this browser yet.
          </p>
        ) : (
          <ul className="space-y-2 text-sm border border-line divide-y divide-line overflow-hidden">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3 bg-raised/40"
              >
                <span className="font-medium text-ink">
                  {h.label}
                </span>
                <span className="text-ink-faint tabular-nums">
                  {format(new Date(h.at), "d MMM yyyy, HH:mm:ss")}
                </span>
                <span className="text-ink-dim sm:col-span-2">
                  {h.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-ink-faint">
        Player skill recalculation and invite cleanup run on the server
        schedule; ask a developer to expose them here if needed.
      </p>
    </div>
  );
}
