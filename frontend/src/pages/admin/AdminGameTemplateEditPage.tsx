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
  const [teamMode, setTeamMode] = useState<TeamAssignmentMode>("auto-balanced");
  const [matchDuration, setMatchDuration] = useState("10");
  const [allowsDraws, setAllowsDraws] = useState(false);
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
  const [announceWeekday, setAnnounceWeekday] = useState(1);
  const [announceHour, setAnnounceHour] = useState(12);
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
      setFee(t.fee_text ?? String(t.fee));
      setMinPlayers(String(t.min_players));
      setMaxPlayers(String(t.max_players));
      setWaitlistMode(
        t.waitlist_mode === "broadcast" ? "broadcast" : "auto_promote",
      );
      setTeamMode(t.team_assignment_mode ?? "balanced");
      setMatchDuration(String(t.match_duration_minutes ?? 10));
      setAllowsDraws(t.allows_draws === true);
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
      fee_text: fee.trim() || null,
      min_players: min,
      max_players: max,
      waitlist_mode: waitlistMode,
      team_assignment_mode: teamMode,
      is_active: isActive,
      match_duration_minutes: Number(matchDuration) || 10,
      allows_draws: allowsDraws,
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
    return <p className="p-6 text-danger">Invalid template id</p>;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2
          className="w-8 h-8 animate-spin text-ink-dim"
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
        className="inline-flex items-center gap-2 text-sm text-ink-dim hover:text-ink"
      >
        <ArrowLeft className="w-4 h-4" />
        All templates
      </Link>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="border border-line bg-panel p-6 space-y-5"
      >
        {error && (
          <div
            className="border border-danger/40 bg-danger/15 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {error}
          </div>
        )}

        {!isNew && meetupCount != null && meetupCount > 0 && (
          <p className="text-xs text-live border border-live/40 bg-live/15 px-3 py-2">
            {meetupCount} materialized meetup{meetupCount === 1 ? "" : "s"}{" "}
            reference this template. You can still edit schedule and defaults;
            delete is disabled until no meetups use this template.
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Template name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Default location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Copied onto new meetups"
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Venue coordinates <span className="text-ink-faint">(optional)</span>
          </label>
          <LocationPicker value={coords} onChange={setCoords} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-dim mb-1">
              Min players
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={minPlayers}
              onChange={(e) => setMinPlayers(e.target.value)}
              className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-dim mb-1">
              Max players
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Fee
          </label>
          <input
            type="text"
            placeholder="e.g. 8 credits"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Waitlist mode
          </label>
          <select
            value={waitlistMode}
            onChange={(e) => setWaitlistMode(e.target.value as WaitlistMode)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            <option value="auto_promote">Auto-promote</option>
            <option value="broadcast">Broadcast</option>
          </select>
        </div>

        <div>
          <label htmlFor="template-team-assignment" className="block text-xs font-medium text-ink-dim mb-1">
            Team assignment
          </label>
          <select
            id="template-team-assignment"
            value={teamMode}
            onChange={(e) => setTeamMode(e.target.value as TeamAssignmentMode)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            <option value="auto-balanced">Auto-balanced</option>
            <option value="balanced">Balanced (skill snake)</option>
            <option value="random">Random order (snake)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Match duration (minutes)
          </label>
          <input
            type="number"
            min={1}
            max={60}
            value={matchDuration}
            onChange={(e) => setMatchDuration(e.target.value)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          />
        </div>

        <div className="flex items-start justify-between gap-4 border border-line bg-raised px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">Record draws</p>
            <p className="text-xs text-ink-dim mt-0.5">
              A level score always ends with the away team winning (the home
              side must win to play again). When on, the match is also
              recorded as a draw for statistics.
            </p>
          </div>
          <input
            type="checkbox"
            checked={allowsDraws}
            onChange={(e) => setAllowsDraws(e.target.checked)}
            className="mt-1 h-5 w-5 accent-live"
            aria-label="Record draws"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-dim mb-1">
            Reference datetime (for “sync from start” only)
          </label>
          <input
            type="datetime-local"
            value={anchorStartLocal}
            onChange={(e) => setAnchorStartLocal(e.target.value)}
            className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          />
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
        />

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 bg-ink text-board font-bold hover:bg-white/90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isNew ? "Create template" : "Save changes"}
          </button>
          {!isNew && (
            <button
              type="button"
              disabled={!canDelete}
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-40"
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
