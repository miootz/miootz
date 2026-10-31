import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, LogOut, User } from "lucide-react";
import { useToast } from "../context/ToastContext";
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
import { SKILL_SCALE_BLURB } from "../components/OnboardingCard";
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
  const { me, logout } = useAuth();
  const { showToast } = useToast();

  // Profile field state
  const [selfAssessed, setSelfAssessed] = useState<number | "">("");
  const [primarySpecialty, setPrimarySpecialty] = useState<Specialty | "">("");
  const [secondarySpecialty, setSecondarySpecialty] = useState<Specialty | "">(
    "",
  );
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
  const skillSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [skillSaved, setSkillSaved] = useState(false);

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
          setSkillSaved(true);
          if (skillSavedTimerRef.current)
            clearTimeout(skillSavedTimerRef.current);
          skillSavedTimerRef.current = setTimeout(
            () => setSkillSaved(false),
            1500,
          );
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
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-ink truncate">
                {displayName}
              </h1>
              <p className="text-sm text-ink-dim truncate">
                {u.pocket_id_sub ?? ""}
              </p>
            </div>
            <a
              href={pocketIdSettingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 border border-line px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors"
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
          </div>
        </section>

        {/* ── Zone 2: Stats & Skill ─────────────────────────────── */}
        {statsError && (
          <p className="text-sm text-danger">
            {statsError}
          </p>
        )}

        <section className="border border-line bg-panel p-5 space-y-5">
          {/* Stats grid */}
          {stats && (
            <div>
              <h2 className="text-lg font-bold text-ink mb-3">
                Your stats
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Meetups played"
                  value={String(stats.games_played)}
                />
                <StatCard
                  label="This season"
                  value={String(stats.season_games)}
                />
                <StatCard
                  label="Avg. rating"
                  value={stats.average_rating.toFixed(1)}
                />
                <StatCard
                  label="Ratings received"
                  value={String(stats.total_ratings)}
                />
                <StatCard
                  label="Season goals"
                  value={String(stats.season_goals)}
                />
                <StatCard
                  label="Season assists"
                  value={String(stats.season_assists)}
                />
              </div>
            </div>
          )}

          {/* Self vs calculated skill bars */}
          {selfSkill != null &&
            calcSkill != null &&
            selfSkill >= 1 &&
            selfSkill <= 5 && (
              <div className="space-y-3 pt-2 border-t border-line">
                <h2 className="text-lg font-bold text-ink">
                  Skill comparison
                </h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-ink-dim">
                    <span>Self-assessed</span>
                    <span className="font-medium text-ink tabular-nums">
                      {selfSkill}/5
                    </span>
                  </div>
                  <div className="h-2 w-full bg-raised">
                    <div
                      className="h-full bg-ink"
                      style={{ width: `${(selfSkill / 5) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-dim">
                    <span>Calculated (peers)</span>
                    <span className="font-medium text-ink tabular-nums">
                      {calcSkill.toFixed(1)}/5
                    </span>
                  </div>
                  <div className="h-2 w-full bg-raised">
                    <div
                      className="h-full bg-team-a"
                      style={{
                        width: `${Math.min(100, Math.max(0, (calcSkill / 5) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

          {/* Skill editor + positions */}
          <div className="space-y-4 pt-2 border-t border-line">
            <h2 className="text-lg font-bold text-ink">
              Edit profile
            </h2>

            <label className="block space-y-1.5">
              <span className="text-xs text-ink-dim">
                Self-assessed skill (1–5)
              </span>
              <StarRating
                value={selfAssessed === "" ? 0 : selfAssessed}
                onChange={onSkillChange}
                label="Skill rating"
              />
              <span className="text-2xs text-ink-dim">
                {SKILL_SCALE_BLURB}
              </span>
              {skillSaved && (
                <span
                  className="text-xs font-medium text-team-a"
                  role="status"
                >
                  Saved ✓
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-ink-dim">
                  Primary position
                </span>
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
                <span className="text-xs text-ink-dim">
                  Secondary position
                </span>
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
                  className="bg-ink px-3 py-2 text-sm font-bold text-board hover:bg-white/90 disabled:opacity-50"
                >
                  {pushBusy ? "Registering…" : "Register this device"}
                </button>
              )}
              {pushOn && pushDevices.length === 0 && (
                <p className="text-xs text-ink-dim">
                  This device is registered but not yet visible. Try refreshing.
                </p>
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
              <ul className="divide-y divide-line border border-line overflow-hidden">
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
            <ul className="divide-y divide-line border border-line overflow-hidden">
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

        {me.auth_groups.length > 0 && (
          <CollapsibleSection title="Debug info">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-dim">Admin</dt>
                <dd className="text-right">
                  {me.is_admin ? (
                    <span className="text-team-a font-medium">
                      Yes
                    </span>
                  ) : (
                    <span className="text-ink-dim">No</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-dim">Groups</dt>
                <dd className="text-right">
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {me.auth_groups.map((g) => (
                      <span
                        key={g}
                        className="inline-block px-2 py-0.5 text-xs font-medium bg-raised text-ink-dim"
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

/* ── Stat Card ─────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-raised px-3 py-2.5 text-center">
      <p className="text-2xl font-bold tabular-nums text-ink">
        {value}
      </p>
      <p className="text-xs text-ink-dim">{label}</p>
    </div>
  );
}
