import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import {
  adminCreateGameTemplate,
  adminDeleteGameTemplate,
  adminGetGameTemplate,
  adminUpdateGameTemplate,
  type GameTemplatePayload,
  type TeamAssignmentMode,
  type WaitlistMode,
} from "../../api/adminApi";
import { AdminMeetupRecurrenceForm } from "../../components/AdminMeetupRecurrenceForm";
import { AdminBreadcrumb } from "../../components/admin/AdminBreadcrumb";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import {
  LocationPicker,
  type GeoPoint,
} from "../../components/admin/LocationPicker";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useToast } from "../../context/ToastContext";

function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminGameTemplateEditPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isNew = templateId === "new";
  const id = !isNew && templateId ? parseInt(templateId, 10) : NaN;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState("Meetup");
  const [location, setLocation] = useState("");
  const [coords, setCoords] = useState<GeoPoint | null>(null);
  const [fee, setFee] = useState("0");
  const [minPlayers, setMinPlayers] = useState("10");
  const [maxPlayers, setMaxPlayers] = useState("15");
  const [waitlistMode, setWaitlistMode] =
    useState<WaitlistMode>("auto_promote");
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>("balanced");
  const [matchDuration, setMatchDuration] = useState("10");
  const [isActive, setIsActive] = useState(true);
  const [anchorStartLocal, setAnchorStartLocal] = useState(defaultStartLocal);

  const [recurrenceTz, setRecurrenceTz] = useState(() =>
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC",
  );
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [recurrenceHour, setRecurrenceHour] = useState(19);
  const [recurrenceMinute, setRecurrenceMinute] = useState(0);
  const [announceTz, setAnnounceTz] = useState(() =>
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC",
  );
  const [announceWeekday, setAnnounceWeekday] = useState(0);
  const [announceHour, setAnnounceHour] = useState(9);
  const [announceMinute, setAnnounceMinute] = useState(0);

  const [meetupCount, setMeetupCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (isNew || Number.isNaN(id)) return;
    setError(null);
    try {
      const t = await adminGetGameTemplate(id);
      setName(t.name);
      setLocation(t.location);
      if (t.latitude != null && t.longitude != null) {
        setCoords({ lat: t.latitude, lng: t.longitude });
      } else {
        setCoords(null);
      }
      setFee(String(t.fee));
      setMinPlayers(String(t.min_players));
      setMaxPlayers(String(t.max_players));
      setWaitlistMode(
        t.waitlist_mode === "broadcast" ? "broadcast" : "auto_promote",
      );
      setTeamMode(t.team_assignment_mode === "random" ? "random" : "balanced");
      setMatchDuration(String(t.match_duration_minutes ?? 10));
      setIsActive(t.is_active);
      setRecurrenceTz(t.timezone);
      setRecurrenceWeekday(t.weekday);
      setRecurrenceHour(t.hour);
      setRecurrenceMinute(t.minute);
      setAnnounceTz(t.announce_timezone);
      setAnnounceWeekday(t.announce_weekday);
      setAnnounceHour(t.announce_hour);
      setAnnounceMinute(t.announce_minute);
      setMeetupCount(t.materialized_meetup_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const min = Number(minPlayers);
    const max = Number(maxPlayers);
    if (max < min) {
      setError("Max players must be ≥ min players.");
      return;
    }
    if (!location.trim()) {
      setError("Location is required.");
      return;
    }
    const body: GameTemplatePayload = {
      name: name.trim() || "Meetup",
      timezone: recurrenceTz.trim() || "UTC",
      weekday: recurrenceWeekday,
      hour: recurrenceHour,
      minute: recurrenceMinute,
      announce_timezone: announceTz.trim() || "UTC",
      announce_weekday: announceWeekday,
      announce_hour: announceHour,
      announce_minute: announceMinute,
      location: location.trim(),
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      fee: Number(fee) || 0,
      min_players: min,
      max_players: max,
      waitlist_mode: waitlistMode,
      team_assignment_mode: teamMode,
      is_active: isActive,
      match_duration_minutes: Number(matchDuration) || 10,
    };
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await adminCreateGameTemplate(body);
        showToast("Template created.", "success");
        navigate(`/admin/game-templates/${created.id}`, { replace: true });
      } else {
        await adminUpdateGameTemplate(id, body);
        showToast("Template saved.", "success");
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    try {
      await adminDeleteGameTemplate(id);
      showToast("Template deleted.", "success");
      navigate("/admin/game-templates");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setConfirmDelete(false);
    }
  }

  if (!isNew && Number.isNaN(id)) {
    return <p className="p-6 text-red-600">Invalid template id</p>;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2
          className="w-8 h-8 animate-spin text-teal-700"
          aria-label="Loading"
        />
      </div>
    );
  }

  const canDelete = !isNew && (meetupCount === 0 || meetupCount === null);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <AdminPageHeader
        breadcrumb={
          <AdminBreadcrumb
            items={[
              { label: "Admin", to: "/admin" },
              { label: "Game templates", to: "/admin/game-templates" },
              { label: isNew ? "New" : name },
            ]}
          />
        }
        title={isNew ? "New game template" : "Edit game template"}
        subtitle="Kickoff schedule, announce time, and defaults copied onto each auto-created meetup."
      />

      <Link
        to="/admin/game-templates"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-teal-700"
      >
        <ArrowLeft className="w-4 h-4" />
        All templates
      </Link>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-5"
      >
        {error && (
          <div
            className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        {!isNew && meetupCount != null && meetupCount > 0 && (
          <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
            {meetupCount} materialized meetup{meetupCount === 1 ? "" : "s"}{" "}
            reference this template. You can still edit schedule and defaults;
            delete is disabled until no meetups use this template.
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Template name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Default location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Copied onto new meetups"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Venue coordinates <span className="text-gray-400">(optional)</span>
          </label>
          <LocationPicker value={coords} onChange={setCoords} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Min players
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={minPlayers}
              onChange={(e) => setMinPlayers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Max players
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Fee
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Waitlist mode
          </label>
          <select
            value={waitlistMode}
            onChange={(e) => setWaitlistMode(e.target.value as WaitlistMode)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
          >
            <option value="auto_promote">Auto-promote</option>
            <option value="broadcast">Broadcast</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Team assignment
          </label>
          <select
            value={teamMode}
            onChange={(e) => setTeamMode(e.target.value as TeamAssignmentMode)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
          >
            <option value="balanced">Balanced (skill snake)</option>
            <option value="random">Random order (snake)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Match duration (minutes)
          </label>
          <input
            type="number"
            min={1}
            max={60}
            value={matchDuration}
            onChange={(e) => setMatchDuration(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Duration for each team-vs-team match during live meetups.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Reference datetime (for “sync from start” only)
          </label>
          <input
            type="datetime-local"
            value={anchorStartLocal}
            onChange={(e) => setAnchorStartLocal(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Optional helper — use “Match start time above” in the schedule block
            to align kickoff fields.
          </p>
        </div>

        <AdminMeetupRecurrenceForm
          startLocal={anchorStartLocal}
          enabled={isActive}
          onEnabledChange={setIsActive}
          scheduleToggleLabel="Schedule active"
          hideMatchStartButton={false}
          kickoffHelperText="Kickoff wall time each week (used when materializing the next meetup)."
          timezone={recurrenceTz}
          onTimezoneChange={setRecurrenceTz}
          weekday={recurrenceWeekday}
          onWeekdayChange={setRecurrenceWeekday}
          hour={recurrenceHour}
          onHourChange={setRecurrenceHour}
          minute={recurrenceMinute}
          onMinuteChange={setRecurrenceMinute}
          announceTimezone={announceTz}
          onAnnounceTimezoneChange={setAnnounceTz}
          announceWeekday={announceWeekday}
          onAnnounceWeekdayChange={setAnnounceWeekday}
          announceHour={announceHour}
          onAnnounceHourChange={setAnnounceHour}
          announceMinute={announceMinute}
          onAnnounceMinuteChange={setAnnounceMinute}
          showDisabledHint={false}
        />

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-teal-700 text-white font-medium hover:bg-teal-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isNew ? "Create template" : "Save changes"}
          </button>
          {!isNew && (
            <button
              type="button"
              disabled={!canDelete}
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete template?"
        description="This cannot be undone. Only allowed when no meetups reference this template."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
