import { ToggleSwitch } from "../../components/ToggleSwitch";
import { useEffect, useState } from "react";
import { Bell, Download, Loader2, Play } from "lucide-react";
import { format } from "date-fns";
import { adminExportData, adminRunRecurringNow, adminSendTestPush } from "../../api/adminApi";
import { fetchRatingSettings, saveRatingSettings, type RatingSettings } from "../../api/ratingSettingsApi";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { StickyFormBar } from "../../components/StickyFormBar";
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
  const [ratingSettings, setRatingSettings] = useState<RatingSettings | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [savingRatings, setSavingRatings] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
  const [history, setHistory] = useState<JobHistoryEntry[]>([]);
  const [exportStatus, setExportStatus] = useState<
    "idle" | "preparing" | "downloaded"
  >("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [sendingPush, setSendingPush] = useState(false);
  const [pushResult, setPushResult] = useState<{ sent: number; failed: number; expired: number } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const exporting = exportStatus === "preparing";

  useEffect(() => {
    setHistory(readJobHistory());
    void fetchRatingSettings().then(setRatingSettings).catch((e: unknown) => {
      setRatingError(e instanceof Error ? e.message : "Could not load rating settings");
    });
  }, []);

  async function saveRatings(event: React.FormEvent) {
    event.preventDefault();
    if (!ratingSettings) return;
    setSavingRatings(true);
    setRatingSaved(false);
    setRatingError(null);
    try {
      setRatingSettings(await saveRatingSettings(ratingSettings));
      setRatingSaved(true);
    } catch (e) {
      setRatingError(e instanceof Error ? e.message : "Could not save rating settings");
    } finally {
      setSavingRatings(false);
    }
  }

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

  async function exportData() {
    if (exporting) return;
    setExportStatus("preparing");
    setExportError(null);
    try {
      const url = URL.createObjectURL(await adminExportData());
      const link = document.createElement("a");
      link.href = url;
      link.download = `miootz-export-${format(new Date(), "yyyy-MM-dd")}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus("downloaded");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
      setExportStatus("idle");
    }
  }

  async function sendTestPush() {
    if (sendingPush) return;
    setSendingPush(true);
    setPushError(null);
    setPushResult(null);
    try {
      setPushResult(await adminSendTestPush());
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Could not send test notification");
    } finally {
      setSendingPush(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-10 pb-28">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[{ label: "Admin", to: "/admin" }, { label: "Tools" }]}
          />
        }
        title="Tools"
      />

      <section className="border border-line bg-panel p-6">
        <h2 className="text-lg font-bold text-ink">Player ratings</h2>
        {ratingSettings && (
          <form id="rating-settings-form" onSubmit={(event) => void saveRatings(event)} className="mt-4 space-y-5">
            <div className="flex min-h-11 items-center gap-3 text-sm text-ink">
              <ToggleSwitch enabled={ratingSettings.computed_scores} disabled={savingRatings}
                ariaLabel="Use adjusted ratings" onChange={() => {
                  setRatingSaved(false);
                  setRatingSettings({ ...ratingSettings, computed_scores: !ratingSettings.computed_scores });
                }} />
              <span>Use adjusted ratings</span>
            </div>
            <p className="text-sm text-ink-dim">Turn off to use base ratings for rankings and team balancing.</p>
            <fieldset disabled={savingRatings}>
              <legend className="font-semibold text-ink">Peer ratings</legend>
              <div className="mt-2 space-y-1">
                {([
                  ["off", "Off"],
                  ["teammates-only", "Teammates only"],
                  ["everyone", "Everyone"],
                ] as const).map(([value, label]) => (
                  <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-ink">
                    <input
                      type="radio"
                      name="peer-rating-mode"
                      value={value}
                      className="h-5 w-5 accent-live"
                      checked={ratingSettings.peer_rating_mode === value}
                      onChange={() => {
                        setRatingSaved(false);
                        setRatingSettings({ ...ratingSettings, peer_rating_mode: value });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-sm text-ink-dim">At least three eligible players must rate the same player at a meetup before those ratings affect skill.</p>
            </fieldset>
            {ratingSaved && <p role="status" className="text-sm text-team-a">Rating settings saved.</p>}
          </form>
        )}
        {ratingError && <p role="alert" className="mt-3 text-sm text-danger">{ratingError}</p>}
        {!ratingSettings && !ratingError && <p role="status" className="mt-3 text-sm text-ink-dim">Loading rating settings…</p>}
      </section>

      <section className="border border-line bg-panel p-6">
        <h2 className="text-base font-semibold text-ink">Test push notifications</h2>
        <p className="mt-1 mb-4 text-sm text-ink-dim">
          Send a notification to your registered devices.
        </p>
        <button
          type="button"
          onClick={() => void sendTestPush()}
          disabled={sendingPush}
          className="inline-flex min-h-11 items-center gap-2 bg-ink px-5 py-2.5 font-bold text-board hover:bg-white/90 disabled:opacity-50"
        >
          {sendingPush ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
          {sendingPush ? "Sending…" : "Send a test push notification to myself"}
        </button>
        <p role="status" className="mt-3 text-sm text-ink-dim empty:sr-only">
          {pushResult && (
            pushResult.sent === 0 && pushResult.failed === 0 && pushResult.expired === 0
              ? "No devices registered. Register this device in your profile."
              : `Sent: ${pushResult.sent} · Failed: ${pushResult.failed} · Expired: ${pushResult.expired}`
          )}
        </p>
        {pushError && <p role="alert" className="mt-3 text-sm text-danger">{pushError}</p>}
      </section>

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
        <p className="text-sm text-ink-dim mb-4">
          Download one CSV per table, with IDs and a foreign key guide. Chats,
          audit logs, calculated rankings, and access credentials are excluded.
        </p>
        {exportError && (
          <p className="mb-4 text-sm text-danger" role="alert">
            {exportError}
          </p>
        )}
        <button
          type="button"
          onClick={() => void exportData()}
          aria-disabled={exporting}
          className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 border border-line text-ink-dim font-medium hover:bg-raised hover:text-ink aria-disabled:opacity-50 transition-colors"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Download className="w-4 h-4" aria-hidden />
          )}
          {exporting ? "Preparing CSV archive…" : "Download CSV archive"}
        </button>
        <p className="mt-3 text-sm text-ink-dim empty:sr-only" role="status">
          {exportStatus === "downloaded" ? "CSV archive download started." : ""}
        </p>
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
      {ratingSettings && (
        <StickyFormBar innerClassName="max-w-xl">
          <button
            type="submit"
            form="rating-settings-form"
            disabled={savingRatings}
            className="w-full min-h-12 bg-ink px-5 py-2 font-bold text-board hover:bg-white/90 disabled:opacity-50"
          >
            {savingRatings ? "Saving…" : "Save rating settings"}
          </button>
        </StickyFormBar>
      )}
    </div>
  );
}
