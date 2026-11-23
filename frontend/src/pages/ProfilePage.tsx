import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, LogOut, User, XCircle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "../context/ToastContext";
import {
  fetchGameTemplateSubscriptions,
  fetchMyHistory,
  fetchMyStats,
  fetchNotificationPreferences,
  patchGameTemplateSubscription,
  patchNotificationPreference,
  type GameTemplateSubscriptionRow,
  type NotificationCategory,
  type NotificationPreferenceRow,
  type Specialty,
  type UserHistoryItem,
  type UserStats,
} from "../api/meApi";
import { useAuth } from "../auth/useAuth";
import { getPocketIdUrl } from "../auth/pocketIdOidc";
import { PlayerAvatarFace } from "../components/PlayerAvatar";
import { ProfileProgress } from "../components/ProfileProgress";
import { ProfileScoreboard } from "../components/ProfileScoreboard";
import { PlayerAttributesPanel } from "../components/PlayerAttributesPanel";
import { SkillRating } from "../components/SkillRating";
import {
  PUSH_REGISTRATION_CHANGED,
  pushSupported,
  subscribeToWebPush,
  fetchPushSubscriptions,
  deletePushSubscription,
  type PushSubscriptionRow,
} from "../utils/pushSubscription";

/* ── Constants ─────────────────────────────────────────────────────── */

const SPECIALTY_OPTIONS: { value: Specialty; label: string }[] = [
  { value: "ATT", label: "Attacker" },
  { value: "MID", label: "Midfielder" },
  { value: "DEF", label: "Defender" },
  { value: "GK", label: "Goalkeeper" },
];

const SPECIALTY_LABEL: Record<Specialty, string> = Object.fromEntries(
  SPECIALTY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<Specialty, string>;

const NOTIF_CATEGORY_META: Record<
  NotificationCategory,
  { display_name: string; description: string }
> = {
  meetup_invite: {
    display_name: "New meetup announcements",
    description: "When a new meetup is added to the schedule",
  },
  waitlist: {
    display_name: "Waitlist alerts",
    description: "When a spot opens or you are promoted from the waitlist",
  },
  chat: {
    display_name: "Chat messages",
    description: "New messages in meetups you attend",
  },
  meetup_cancelled: {
    display_name: "Meetup cancelled",
    description: "When an admin removes a meetup",
  },
  kickoff_reminder: {
    display_name: "Kickoff reminder",
    description: "Reminder one hour before kickoff",
  },
  rating_reminder: {
    display_name: "Rating reminder",
    description: "Prompt to rate teammates after the meetup ends",
  },
};

/* ── Collapsible Section ───────────────────────────────────────────── */

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-line bg-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-raised transition-colors"
        aria-expanded={open}
      >
        <span className="text-lg font-bold text-ink">
          {title}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-ink-dim transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`transition-all duration-200 overflow-hidden ${
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────── */

function ProfileSkeleton() {
  const pulse =
    "motion-safe:animate-pulse motion-reduce:animate-none rounded bg-raised";

  return (
    <div
      className="mx-auto max-w-lg space-y-6 p-6"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className={`h-24 rounded-xl ${pulse}`} />
      <div className={`h-40 rounded-xl ${pulse}`} />
      <div className={`h-32 rounded-xl ${pulse}`} />
    </div>
  );
}

/* ── Toggle Switch (reusable) ──────────────────────────────────────── */

function ToggleSwitch({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-hidden focus:ring-2 focus:ring-live ${
        enabled ? "bg-live" : "bg-raised"
      } disabled:opacity-50`}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform bg-ink transition ${
          enabled ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export function ProfilePage() {
  const { me, logout, savePosition } = useAuth();
  const { showToast } = useToast();

  // Profile field state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Push notification state
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);
  const [pushDevices, setPushDevices] = useState<PushSubscriptionRow[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [pushStateError, setPushStateError] = useState<string | null>(null);
  const [pushRegistrationError, setPushRegistrationError] = useState<string | null>(null);
  const [pushRefresh, setPushRefresh] = useState(0);
  const [deviceRemoveId, setDeviceRemoveId] = useState<number | null>(null);

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferenceRow[]>([]);
  const [notifPrefsLoading, setNotifPrefsLoading] = useState(false);
  const [notifToggleBusy, setNotifToggleBusy] =
    useState<NotificationCategory | null>(null);

  // Stats state
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Weekly meetup subscriptions state
  const [templateSubs, setTemplateSubs] = useState<
    GameTemplateSubscriptionRow[]
  >([]);
  const [templateSubsLoading, setTemplateSubsLoading] = useState(false);
  const [templateToggleBusy, setTemplateToggleBusy] = useState<number | null>(
    null,
  );

  /* ── Effects ───────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    setNotifPrefsLoading(true);
    void fetchNotificationPreferences()
      .then((r) => {
        if (!cancelled) setNotifPrefs(r.items);
      })
      .catch(() => {
        if (!cancelled) setNotifPrefs([]);
      })
      .finally(() => {
        if (!cancelled) setNotifPrefsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !pushSupported()) return;
    const refresh = () => setPushRefresh((value) => value + 1);
    window.addEventListener(PUSH_REGISTRATION_CHANGED, refresh);
    return () => window.removeEventListener(PUSH_REGISTRATION_CHANGED, refresh);
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !pushSupported()) return;
    let cancelled = false;
    setDevicesLoading(true);
    setPushStateError(null);
    void (async () => {
      try {
        const [registration, devices] = await Promise.all([
          navigator.serviceWorker.getRegistration(),
          fetchPushSubscriptions(),
        ]);
        const local = await registration?.pushManager.getSubscription();
        if (!cancelled) {
          setPushEndpoint(local?.endpoint ?? null);
          setPushDevices(devices);
        }
      } catch (e) {
        if (!cancelled) {
          const reason = e instanceof Error ? e.message : "Unknown error";
          setPushStateError(`Could not check notification registration. ${reason}`);
        }
      } finally {
        if (!cancelled) setDevicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushRefresh]);

  useEffect(() => {
    let cancelled = false;
    setTemplateSubsLoading(true);
    void fetchGameTemplateSubscriptions()
      .then((r) => {
        if (!cancelled) setTemplateSubs(r.items);
      })
      .catch(() => {
        if (!cancelled) setTemplateSubs([]);
      })
      .finally(() => {
        if (!cancelled) setTemplateSubsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchMyStats()
      .then((s) => {
        if (!cancelled) {
          setStats(s);
          setStatsError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setStats(null);
          setStatsError(
            e instanceof Error ? e.message : "Could not load stats",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Handlers ──────────────────────────────────────────────────── */

  const saveSpecialty = async (
    field: "primary_specialty" | "secondary_specialty",
    value: Specialty | null,
  ) => {
    if (value === (me?.user[field] ?? null)) return;
    setSaving(true);
    setError(null);
    try {
      await savePosition(field, value);
      showToast("Position saved.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  /* ── Early return ──────────────────────────────────────────────── */

  if (!me) {
    return (
      <div className="min-h-[50vh]">
        <ProfileSkeleton />
      </div>
    );
  }

  const u = me.user;
  const displayName = u.display_name ?? u.pocket_id_sub ?? "—";
  const avatarUrl = u.avatar_url ?? undefined;
  const pocketIdSettingsUrl = `${getPocketIdUrl()}/settings/account`;

  const pushEnabled = import.meta.env.PROD && pushSupported();
  const pushOn = pushEndpoint != null && pushDevices.some((device) => device.endpoint === pushEndpoint);

  return (
    <div className="min-h-screen bg-board text-ink">
      <div className="max-w-lg mx-auto p-6 space-y-6">
        {/* ── Zone 1: Identity Hero ─────────────────────────────── */}
        <section className="border border-line bg-panel p-5">
          <div className="flex items-center gap-4">
            <PlayerAvatarFace
              name={displayName}
              avatarUrl={avatarUrl}
              size="md"
            />
            <h1 className="min-w-0 flex-1 text-balance text-xl font-bold text-ink [overflow-wrap:anywhere]">
              {displayName}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            {u.primary_specialty && (
              <span className="inline-block px-2.5 py-1 text-xs font-medium bg-raised text-ink-dim">
                {SPECIALTY_LABEL[u.primary_specialty]}
              </span>
            )}
            {u.secondary_specialty && (
              <span className="inline-block px-2.5 py-1 text-xs font-medium bg-raised text-ink-dim">
                {SPECIALTY_LABEL[u.secondary_specialty]}
              </span>
            )}
            {me.is_admin && (
              <span className="inline-block px-2.5 py-1 text-xs font-medium bg-raised text-ink-dim">
                Admin
              </span>
            )}
            <a
              href={pocketIdSettingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 border border-line px-3 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
              aria-label="Edit account in Pocket ID"
            >
              <User className="w-3.5 h-3.5" />
              Edit
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </section>

        <section aria-label="Player ratings" className="grid grid-cols-2 divide-x divide-line border border-line bg-panel">
          {([
            { label: "Base Rating", value: stats?.base_rating, disabled: false },
            { label: "Adjusted Rating", value: stats?.adjusted_rating === undefined ? u.calculated_skill : stats.adjusted_rating, disabled: stats?.computed_scores === false },
          ]).map(({ label, value, disabled }) => (
            <div key={label} className="min-w-0 p-5">
              <h2 className="text-sm font-bold text-ink">{label}</h2>
              <p className="mt-2 text-2xl text-ink"><SkillRating score={disabled ? null : value} /></p>
              <p className="mt-1 text-xs text-ink-dim">{disabled ? "Disabled" : value == null ? "Unrated" : "out of 5"}</p>
            </div>
          ))}
        </section>

        {stats?.computed_scores !== false && (
          <PlayerAttributesPanel
            attributes={stats?.attributes}
            error={statsError ?? (stats && !stats.attributes ? "Attributes are unavailable." : null)}
          />
        )}

        <ProfileScoreboard stats={stats} error={statsError} />
        <ProfileProgress />

        <section className="border border-line bg-panel p-5 space-y-5">
          {/* Attendance history (paginated) */}
          <AttendanceHistory userId={u.id} />

          {/* Positions editor */}
          <div className="space-y-4 pt-2 border-t border-line">
            <h2 className="text-lg font-bold text-ink">
              Edit profile
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="profile-primary-position" className="block text-xs text-ink-dim">
                  Primary position
                </label>
                <select
                  id="profile-primary-position"
                  value={u.primary_specialty ?? ""}
                  disabled={saving}
                  onChange={(e) => {
                    void saveSpecialty(
                      "primary_specialty",
                      (e.target.value || null) as Specialty | null,
                    );
                  }}
                  className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live disabled:opacity-50"
                >
                  <option value="">— Select —</option>
                  {SPECIALTY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="profile-secondary-position" className="block text-xs text-ink-dim">
                  Secondary position
                </label>
                <select
                  id="profile-secondary-position"
                  value={u.secondary_specialty ?? ""}
                  disabled={saving}
                  onChange={(e) => {
                    void saveSpecialty(
                      "secondary_specialty",
                      (e.target.value || null) as Specialty | null,
                    );
                  }}
                  className="w-full border border-line bg-raised px-3 py-2 text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-live disabled:opacity-50"
                >
                  <option value="">— Select —</option>
                  {SPECIALTY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* ── Zone 3: Preferences (collapsible) ─────────────────── */}

        {pushEnabled && (
          <CollapsibleSection title="Push notifications">
            {/* Device list */}
            <div className="space-y-3 mb-4">
              <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
                Registered devices
              </span>
              {devicesLoading ? (
                <p className="text-sm text-ink-dim">
                  Loading…
                </p>
              ) : pushStateError ? (
                <div className="space-y-2">
                  <p className="text-sm text-danger" role="alert">{pushStateError}</p>
                  <button
                    type="button"
                    className="min-h-11 text-sm font-medium text-ink underline underline-offset-2"
                    onClick={() => setPushRefresh((value) => value + 1)}
                  >
                    Retry
                  </button>
                </div>
              ) : pushDevices.length === 0 ? (
                <p className="text-sm text-ink-dim">
                  No devices registered yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {pushDevices.map((dev) => {
                    const ep = dev.endpoint;
                    const host = (() => {
                      try {
                        return new URL(ep).hostname;
                      } catch {
                        return ep.slice(0, 40) + "…";
                      }
                    })();
                    const date = (() => {
                      try {
                        return new Date(dev.created_at).toLocaleDateString();
                      } catch {
                        return "";
                      }
                    })();
                    return (
                      <li
                        key={dev.id}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-ink truncate">
                            {host}
                            {ep === pushEndpoint && <span className="text-ink-dim"> · This device</span>}
                          </p>
                          {date && (
                            <p className="text-xs text-ink-dim">
                              {date}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={deviceRemoveId === dev.id}
                          onClick={() => {
                            setDeviceRemoveId(dev.id);
                            void deletePushSubscription(dev.id)
                              .then(() => {
                                setPushDevices((prev) =>
                                  prev.filter((d) => d.id !== dev.id),
                                );
                                showToast("Device removed.", "success");
                              })
                              .catch((e) => {
                                showToast(
                                  e instanceof Error
                                    ? e.message
                                    : "Could not remove device",
                                  "error",
                                );
                              })
                              .finally(() => setDeviceRemoveId(null));
                          }}
                          className="shrink-0 text-xs text-danger hover:text-ink disabled:opacity-50"
                        >
                          {deviceRemoveId === dev.id ? "Removing…" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!devicesLoading && !pushStateError && !pushOn && (
                <button
                  type="button"
                  disabled={pushBusy}
                  onClick={() => {
                    setPushBusy(true);
                    setPushRegistrationError(null);
                    void (async () => {
                      try {
                        const r = await subscribeToWebPush();
                        if (r.ok) {
                          showToast("Device registered.", "success");
                        } else {
                          setPushRegistrationError(r.reason ?? "Could not register device");
                        }
                      } catch (e) {
                        setPushRegistrationError(e instanceof Error ? e.message : "Could not register device");
                      } finally {
                        setPushBusy(false);
                      }
                    })();
                  }}
                  className="bg-ink px-3 py-2 text-sm font-bold text-board hover:bg-white/90 disabled:opacity-50"
                >
                  {pushBusy ? "Registering…" : pushEndpoint ? "Finish registering this device" : "Register this device"}
                </button>
              )}
              {pushRegistrationError && (
                <p role="alert" className="text-sm text-danger">{pushRegistrationError}</p>
              )}
            </div>
          </CollapsibleSection>
        )}

        <CollapsibleSection title="Notification preferences">
          {/* Notification type toggles */}
          <div className="space-y-2">
            <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
              Notification types
            </span>
            {notifPrefsLoading ? (
              <p className="text-sm text-ink-dim">
                Loading…
              </p>
            ) : notifPrefs.length === 0 ? (
              <p className="text-sm text-ink-dim">
                Could not load preferences.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {notifPrefs.map((row) => (
                  <li
                    key={row.category}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <span className="text-sm text-ink">
                        {NOTIF_CATEGORY_META[row.category].display_name}
                      </span>
                      <p className="text-xs text-ink-dim truncate">
                        {NOTIF_CATEGORY_META[row.category].description}
                      </p>
                    </div>
                    <ToggleSwitch
                      enabled={row.enabled}
                      disabled={notifToggleBusy === row.category}
                      onChange={() => {
                        const next = !row.enabled;
                        setNotifToggleBusy(row.category);
                        setNotifPrefs((prev) =>
                          prev.map((p) =>
                            p.category === row.category
                              ? { ...p, enabled: next }
                              : p,
                          ),
                        );
                        void patchNotificationPreference(row.category, next)
                          .catch(() => {
                            setNotifPrefs((prev) =>
                              prev.map((p) =>
                                p.category === row.category
                                  ? { ...p, enabled: row.enabled }
                                  : p,
                              ),
                            );
                            showToast("Could not update preference.", "error");
                          })
                          .finally(() => setNotifToggleBusy(null));
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsibleSection>

        {!pushEnabled && (
          <p className="text-xs text-ink-dim">
            This browser meetup cannot receive push notifications. Your
            preferences still apply to registered devices.
          </p>
        )}

        <CollapsibleSection title="Weekly meetups">
          <p className="text-xs text-ink-dim mb-3">
            Turning this off removes you from the invite list for that
            recurring meetup.
          </p>
          {templateSubsLoading ? (
            <p className="text-sm text-ink-dim">Loading…</p>
          ) : templateSubs.length === 0 ? (
            <p className="text-sm text-ink-dim">
              No active weekly templates yet.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {templateSubs.map((row) => (
                <li
                  key={row.game_template_id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <span className="text-sm text-ink min-w-0 truncate">
                    {row.name}
                  </span>
                  <ToggleSwitch
                    enabled={row.notifications_enabled}
                    disabled={templateToggleBusy === row.game_template_id}
                    onChange={() => {
                      const next = !row.notifications_enabled;
                      setTemplateToggleBusy(row.game_template_id);
                      setTemplateSubs((prev) =>
                        prev.map((p) =>
                          p.game_template_id === row.game_template_id
                            ? { ...p, notifications_enabled: next }
                            : p,
                        ),
                      );
                      void patchGameTemplateSubscription(
                        row.game_template_id,
                        next,
                      )
                        .catch(() => {
                          setTemplateSubs((prev) =>
                            prev.map((p) =>
                              p.game_template_id === row.game_template_id
                                ? {
                                    ...p,
                                    notifications_enabled:
                                      row.notifications_enabled,
                                  }
                                : p,
                            ),
                          );
                          showToast("Could not update preference.", "error");
                        })
                        .finally(() => setTemplateToggleBusy(null));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* ── Zone 4: Account footer ────────────────────────────── */}

        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}

        <div className="pt-2 pb-6">
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="w-full flex items-center justify-center gap-2 border border-danger/40 px-4 py-3 text-danger font-medium hover:bg-danger/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Attendance history (self, paginated) ─────────────────────────── */

const HISTORY_PAGE_SIZE = 25;

function AttendanceHistory({ userId }: { userId: number }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<UserHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyHistory(userId, {
        limit: HISTORY_PAGE_SIZE,
        offset: (page - 1) * HISTORY_PAGE_SIZE,
      });
      setItems(res.history.items);
      setTotal(res.history.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [userId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  return (
    <div className="space-y-3 pt-2 border-t border-line">
      <h2 className="text-lg font-bold text-ink">
        Your attendance history
      </h2>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="text-sm text-ink-dim">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-dim">
          No meetups in your history yet.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((it) => {
              const active = it.metrics.matches > 0;
              const StatusIcon =
                it.status === "confirmed"
                  ? CheckCircle2
                  : it.status === "waitlisted"
                    ? Clock
                    : XCircle;
              const statusLabel =
                it.status === "confirmed"
                  ? "Confirmed"
                  : it.status === "waitlisted"
                    ? "Waitlisted"
                    : "Cancelled";
              return (
                <li key={it.meetup_id}>
                  <Link
                    to={`/history/${it.meetup_id}`}
                    className="flex items-center gap-3 px-3 py-2 min-h-[44px] hover:bg-raised transition-colors"
                  >
                    <StatusIcon
                      className={`h-4 w-4 shrink-0 ${
                        it.status === "cancelled" ? "text-danger" : "text-ink-dim"
                      }`}
                      aria-label={statusLabel}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">
                        {format(new Date(it.start_time), "d MMM yyyy")}
                      </p>
                      {it.status !== "confirmed" &&
                        it.previous_status && (
                          <p className="text-2xs text-ink-faint">
                            (was {it.previous_status})
                          </p>
                        )}
                    </div>
                    {it.rating_avg != null && (
                      <span
                        className="text-2xs font-bold text-ink-dim tabular-nums shrink-0"
                        title="Average peer rating for this meetup"
                      >
                        ★ {it.rating_avg.toFixed(1)}
                      </span>
                    )}
                    {active && (
                      <span
                        className="text-2xs font-bold text-ink-dim tabular-nums shrink-0"
                        title="Goals · Assists · Wins / Matches"
                      >
                        G {it.metrics.goals} · A {it.metrics.assists} · W{" "}
                        {it.metrics.wins}/{it.metrics.matches}
                      </span>
                    )}
                    <ChevronRight
                      className="h-4 w-4 text-ink-faint shrink-0"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 min-h-[44px] border border-line px-4 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
              </button>
              <span className="text-xs text-ink-dim tabular-nums">
                Page {page} of {pages} · {total} meetups
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="inline-flex items-center gap-1 min-h-[44px] border border-line px-4 py-2 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-40 transition-colors"
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
