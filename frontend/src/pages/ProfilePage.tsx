import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, LogOut, Monitor, Moon, Sun, User } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemePreference } from "../theme/themeStorage";
import {
  fetchGameTemplateSubscriptions,
  fetchMyStats,
  fetchNotificationPreferences,
  patchGameTemplateSubscription,
  patchMyProfile,
  patchNotificationPreference,
  type GameTemplateSubscriptionRow,
  type NotificationCategory,
  type NotificationPreferenceRow,
  type Specialty,
  type UserStats,
} from "../api/meApi";
import { useAuth } from "../auth/useAuth";
import { getPocketIdUrl } from "../auth/pocketIdOidc";
import { StarRating } from "../components/StarRating";
import { PlayerAvatarFace } from "../components/PlayerAvatar";
import {
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
  session_invite: {
    display_name: "New session announcements",
    description: "When a new meetup is added to the schedule",
  },
  waitlist: {
    display_name: "Waitlist alerts",
    description: "When a spot opens or you are promoted from the waitlist",
  },
  chat: {
    display_name: "Chat messages",
    description: "New messages in sessions you attend",
  },
  session_cancelled: {
    display_name: "Session cancelled",
    description: "When an admin removes a meetup",
  },
  kickoff_reminder: {
    display_name: "Kickoff reminder",
    description: "Reminder one hour before kickoff",
  },
  rating_reminder: {
    display_name: "Rating reminder",
    description: "Prompt to rate teammates after the session ends",
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
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {title}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
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
    "motion-safe:animate-pulse motion-reduce:animate-none rounded bg-gray-200 dark:bg-gray-700";

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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 ${
        enabled ? "bg-violet-600" : "bg-gray-200 dark:bg-gray-600"
      } disabled:opacity-50`}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
          enabled ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export function ProfilePage() {
  const { me, logout } = useAuth();
  const { showToast } = useToast();
  const { preference, setPreference } = useTheme();

  // Profile field state
  const [selfAssessed, setSelfAssessed] = useState<number | "">("");
  const [primarySpecialty, setPrimarySpecialty] = useState<Specialty | "">("");
  const [secondarySpecialty, setSecondarySpecialty] = useState<Specialty | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Push notification state
  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushDevices, setPushDevices] = useState<PushSubscriptionRow[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
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

  const skillSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Effects ───────────────────────────────────────────────────── */

  useEffect(() => {
    if (!me) return;
    const sa = me.user.self_assessed_skill;
    setSelfAssessed(sa != null && sa >= 1 && sa <= 5 ? sa : "");
    setPrimarySpecialty(me.user.primary_specialty ?? "");
    setSecondarySpecialty(me.user.secondary_specialty ?? "");
  }, [me]);

  useEffect(() => {
    if (!import.meta.env.PROD || !pushSupported()) return;
    let cancelled = false;
    void navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setPushOn(!!sub);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    let cancelled = false;
    setDevicesLoading(true);
    void fetchPushSubscriptions()
      .then((r) => {
        if (!cancelled) setPushDevices(r);
      })
      .catch(() => {
        if (!cancelled) setPushDevices([]);
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    return () => {
      if (skillSaveTimerRef.current) clearTimeout(skillSaveTimerRef.current);
    };
  }, []);

  /* ── Handlers ──────────────────────────────────────────────────── */

  const saveSpecialty = async (
    field: "primary_specialty" | "secondary_specialty",
    value: Specialty | null,
    prev: Specialty | null | undefined,
    setter: React.Dispatch<React.SetStateAction<Specialty | "">>,
  ) => {
    if (value === prev) return;
    setSaving(true);
    setError(null);
    try {
      await patchMyProfile({ [field]: value });
      showToast("Specialty saved.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      showToast(msg, "error");
      setter(prev ?? "");
    } finally {
      setSaving(false);
    }
  };

  const onSkillChange = (v: number) => {
    setSelfAssessed(v);
    if (skillSaveTimerRef.current) clearTimeout(skillSaveTimerRef.current);
    skillSaveTimerRef.current = setTimeout(() => {
      skillSaveTimerRef.current = null;
      void (async () => {
        const baseline = u.self_assessed_skill;
        if (baseline != null && v === baseline) return;
        if (v < 1 || v > 5) return;
        setSaving(true);
        setError(null);
        try {
          await patchMyProfile({ self_assessed_skill: v });
          showToast("Skill saved.", "success");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Save failed";
          setError(msg);
          showToast(msg, "error");
        } finally {
          setSaving(false);
        }
      })();
    }, 450);
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
  const selfSkill = u.self_assessed_skill;
  const calcSkill = u.calculated_skill;
  const pocketIdSettingsUrl = `${getPocketIdUrl()}/settings/account`;

  const pushEnabled = import.meta.env.PROD && pushSupported();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-lg mx-auto p-6 space-y-6">
        {/* ── Zone 1: Identity Hero ─────────────────────────────── */}
        <section className="rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 p-5 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <PlayerAvatarFace
              name={displayName}
              avatarUrl={avatarUrl}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold truncate">{displayName}</h1>
              <p className="text-sm text-violet-100 truncate">
                {u.username}
              </p>
            </div>
            <a
              href={pocketIdSettingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/20 hover:bg-white/30 transition-colors"
              aria-label="Edit account in Pocket ID"
            >
              <User className="w-3.5 h-3.5" />
              Edit
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Position badges */}
          <div className="flex flex-wrap gap-2 mt-4">
            {u.primary_specialty && (
              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-white/20">
                {SPECIALTY_LABEL[u.primary_specialty]}
              </span>
            )}
            {u.secondary_specialty && (
              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-white/10">
                {SPECIALTY_LABEL[u.secondary_specialty]}
              </span>
            )}
            {me.is_admin && (
              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-400/30 text-emerald-100">
                Admin
              </span>
            )}
          </div>
        </section>

        {/* ── Zone 2: Stats & Skill ─────────────────────────────── */}
        {statsError && (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {statsError}
          </p>
        )}

        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-5">
          {/* Stats grid */}
          {stats && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Your stats
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Sessions played" value={String(stats.games_played)} />
                <StatCard label="This season" value={String(stats.season_games)} />
                <StatCard label="Avg. rating" value={stats.average_rating.toFixed(1)} />
                <StatCard label="Ratings received" value={String(stats.total_ratings)} />
              </div>
            </div>
          )}

          {/* Self vs calculated skill bars */}
          {selfSkill != null &&
            calcSkill != null &&
            selfSkill >= 1 &&
            selfSkill <= 5 && (
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Skill comparison
                </h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Self-assessed</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {selfSkill}/5
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${(selfSkill / 5) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Calculated (peers)</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {calcSkill.toFixed(1)}/5
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, (calcSkill / 5) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

          {/* Skill editor + positions */}
          <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Edit profile
            </h2>

            <label className="block space-y-1.5">
              <span className="text-xs text-gray-500">
                Self-assessed skill (1–5)
              </span>
              <StarRating
                value={selfAssessed === "" ? 0 : selfAssessed}
                onChange={onSkillChange}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">Primary position</span>
                <select
                  value={primarySpecialty}
                  disabled={saving}
                  onChange={(e) => {
                    const val = e.target.value as Specialty | "";
                    setPrimarySpecialty(val);
                    void saveSpecialty(
                      "primary_specialty",
                      val || null,
                      u.primary_specialty,
                      setPrimarySpecialty,
                    );
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
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
                <span className="text-xs text-gray-500">Secondary position</span>
                <select
                  value={secondarySpecialty}
                  disabled={saving}
                  onChange={(e) => {
                    const val = e.target.value as Specialty | "";
                    setSecondarySpecialty(val);
                    void saveSpecialty(
                      "secondary_specialty",
                      val || null,
                      u.secondary_specialty,
                      setSecondarySpecialty,
                    );
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
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

        {/* ── Zone 2b: Appearance ───────────────────────────────── */}
        <CollapsibleSection title="Appearance">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Choose your preferred theme. Saved automatically.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "system" as ThemePreference, label: "System", Icon: Monitor },
                { value: "light" as ThemePreference, label: "Light", Icon: Sun },
                { value: "dark" as ThemePreference, label: "Dark", Icon: Moon },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreference(value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                  preference === value
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-950/50 dark:text-violet-300"
                    : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Zone 3: Preferences (collapsible) ─────────────────── */}

        {pushEnabled && (
          <CollapsibleSection title="Push notifications">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Receive in-app notifications on registered devices. Tap a
              notification to open the relevant session.
            </p>

            {/* Device list */}
            <div className="space-y-3 mb-4">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Registered devices
              </span>
              {devicesLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : pushDevices.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
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
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50/50 dark:bg-gray-950/40"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                            {host}
                          </p>
                          {date && (
                            <p className="text-xs text-gray-500">{date}</p>
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
                          className="shrink-0 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50"
                        >
                          {deviceRemoveId === dev.id ? "Removing…" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!pushOn && (
                <button
                  type="button"
                  disabled={pushBusy}
                  onClick={() => {
                    setPushBusy(true);
                    void (async () => {
                      try {
                        const r = await subscribeToWebPush();
                        if (r.ok) {
                          setPushOn(true);
                          const devs = await fetchPushSubscriptions();
                          setPushDevices(devs);
                          showToast("Device registered.", "success");
                        } else {
                          showToast(
                            r.reason ?? "Could not register device",
                            "error",
                          );
                        }
                      } finally {
                        setPushBusy(false);
                      }
                    })();
                  }}
                  className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {pushBusy ? "Registering…" : "Register this device"}
                </button>
              )}
              {pushOn && pushDevices.length === 0 && (
                <p className="text-xs text-gray-500">
                  This device is registered but not yet visible. Try refreshing.
                </p>
              )}
            </div>

            {/* Notification type toggles */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Notification types
              </span>
              {notifPrefsLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : notifPrefs.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Could not load preferences.
                </p>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  {notifPrefs.map((row) => (
                    <li
                      key={row.category}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50/50 dark:bg-gray-950/40"
                    >
                      <div className="min-w-0">
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          {NOTIF_CATEGORY_META[row.category].display_name}
                        </span>
                        <p className="text-xs text-gray-500 truncate">
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
                              showToast(
                                "Could not update preference.",
                                "error",
                              );
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
        )}

        {!import.meta.env.PROD && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Push notifications are available in the production build (HTTPS +
            service worker).
          </p>
        )}

        <CollapsibleSection title="Weekly meetups">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Per-meetup opt-out. Turning this off removes you from the invite
            list for that recurring meetup.
          </p>
          {templateSubsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : templateSubs.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No active weekly templates yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              {templateSubs.map((row) => (
                <li
                  key={row.game_template_id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50/50 dark:bg-gray-950/40"
                >
                  <span className="text-sm text-gray-900 dark:text-gray-100 min-w-0 truncate">
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

        {me.auth_groups.length > 0 && (
          <CollapsibleSection title="Debug info">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Admin</dt>
                <dd className="text-right">
                  {me.is_admin ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Yes
                    </span>
                  ) : (
                    <span className="text-gray-500">No</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Groups</dt>
                <dd className="text-right">
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {me.auth_groups.map((g) => (
                      <span
                        key={g}
                        className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </dd>
              </div>
            </dl>
          </CollapsibleSection>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="pt-2 pb-6">
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 text-center">
      <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
