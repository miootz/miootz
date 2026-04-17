import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  MAX_AVATAR_BYTES,
  fetchMyStats,
  mediaUrl,
  patchMyProfile,
  uploadMyAvatar,
  type UserStats,
} from '../api/meApi';
import { useAuth } from '../auth/useAuth';
import { StarRating } from '../components/StarRating';
import {
  pushSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../utils/pushSubscription';

function ProfileSkeleton() {
  const pulse =
    'motion-safe:animate-pulse motion-reduce:animate-none rounded bg-gray-200 dark:bg-gray-700';

  return (
    <div className="mx-auto max-w-lg space-y-8 p-6" aria-busy="true" aria-label="Loading profile">
      <div className="space-y-3 text-left">
        <div className={`h-4 w-40 ${pulse}`} />
        <div className={`h-8 w-48 ${pulse}`} />
        <div className={`h-3 w-full max-w-sm ${pulse}`} />
      </div>
      <div className={`h-40 rounded-xl border border-gray-200 dark:border-gray-800 ${pulse}`} />
      <div className={`h-56 rounded-xl border border-gray-200 dark:border-gray-800 ${pulse}`} />
    </div>
  );
}

export function ProfilePage() {
  const { me, refresh } = useAuth();
  const { showToast } = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [selfAssessed, setSelfAssessed] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const skillSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!me) return;
    setFullName(me.user.full_name ?? '');
    setPhone(me.user.phone ?? '');
    const sa = me.user.self_assessed_skill ?? me.user.skill_level;
    setSelfAssessed(
      sa != null && sa >= 1 && sa <= 5 ? sa : ''
    );
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
          setStatsError(e instanceof Error ? e.message : 'Could not load stats');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  useEffect(() => {
    return () => {
      if (skillSaveTimerRef.current) clearTimeout(skillSaveTimerRef.current);
    };
  }, []);

  if (!me) {
    return (
      <div className="min-h-[50vh]">
        <ProfileSkeleton />
      </div>
    );
  }

  const u = me.user;
  const sso = me.sso;
  const pic = mediaUrl(u.profile_pic);
  const displayPic = avatarPreview ?? pic;

  const syncName = async () => {
    setSaving(true);
    setError(null);
    try {
      await patchMyProfile({ sync_display_name_from_sso: true });
      await refresh();
      showToast('Display name updated from Authelia.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncEmail = async () => {
    setSaving(true);
    setError(null);
    try {
      await patchMyProfile({ sync_email_from_sso: true });
      await refresh();
      showToast('Email updated from Authelia.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const onAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (JPEG, PNG, or WebP).');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`Image must be at most ${MAX_AVATAR_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    setAvatarBusy(true);
    setError(null);
    try {
      await uploadMyAvatar(file);
      await refresh();
      URL.revokeObjectURL(previewUrl);
      setAvatarPreview(null);
      showToast('Avatar updated.', 'success');
    } catch (err) {
      URL.revokeObjectURL(previewUrl);
      setAvatarPreview(null);
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  const selfSkill = u.self_assessed_skill ?? u.skill_level;
  const calcSkill = u.calculated_skill;

  const saveFullNameBlur = async () => {
    setEditingName(false);
    const next = fullName.trim();
    const prev = (u.full_name ?? '').trim();
    if (next === prev) return;
    setSaving(true);
    setError(null);
    try {
      await patchMyProfile({ full_name: next || null });
      await refresh();
      showToast('Name saved.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      showToast(msg, 'error');
      setFullName(u.full_name ?? '');
    } finally {
      setSaving(false);
    }
  };

  const savePhoneBlur = async () => {
    setEditingPhone(false);
    const next = phone.trim();
    const prev = (u.phone ?? '').trim();
    if (next === prev) return;
    setSaving(true);
    setError(null);
    try {
      await patchMyProfile({ phone: next || null });
      await refresh();
      showToast('Phone saved.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      showToast(msg, 'error');
      setPhone(u.phone ?? '');
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
        const baseline = u.self_assessed_skill ?? u.skill_level ?? null;
        if (baseline != null && v === baseline) return;
        if (v < 1 || v > 5) return;
        setSaving(true);
        setError(null);
        try {
          await patchMyProfile({ self_assessed_skill: v });
          await refresh();
          showToast('Skill saved.', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Save failed';
          setError(msg);
          showToast(msg, 'error');
        } finally {
          setSaving(false);
        }
      })();
    }, 450);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-lg mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-left">Profile</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            App profile is stored here; Authelia is the source for SSO identity.
          </p>
        </div>

        {statsError && (
          <p className="text-left text-sm text-amber-800 dark:text-amber-200">
            {statsError}
          </p>
        )}

        {stats && (
          <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3 text-left">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Your stats
            </h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Sessions played</dt>
                <dd className="font-medium tabular-nums">{stats.games_played}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Avg. rating (from peers)</dt>
                <dd className="font-medium tabular-nums">
                  {stats.average_rating.toFixed(1)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Ratings received</dt>
                <dd className="font-medium tabular-nums">{stats.total_ratings}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Listed skill</dt>
                <dd className="font-medium tabular-nums">{stats.skill_level}</dd>
              </div>
            </dl>
          </section>
        )}

        {selfSkill != null &&
          calcSkill != null &&
          selfSkill >= 1 &&
          selfSkill <= 5 && (
            <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3 text-left">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Self vs calculated skill
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
            </section>
          )}

        {import.meta.env.PROD && pushSupported() && (
          <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3 text-left">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Browser notifications
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Get chat while the app is in the background, a reminder about one hour before
              kickoff, and an alert if a meetup is cancelled. Requires HTTPS and Web Push keys
              on the server.
            </p>
            {pushOn ? (
              <button
                type="button"
                disabled={pushBusy}
                onClick={() => {
                  setPushBusy(true);
                  void (async () => {
                    try {
                      await unsubscribeFromWebPush();
                      setPushOn(false);
                      showToast('Notifications turned off.', 'success');
                    } catch (err) {
                      const msg =
                        err instanceof Error ? err.message : 'Could not unsubscribe';
                      showToast(msg, 'error');
                    } finally {
                      setPushBusy(false);
                    }
                  })();
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {pushBusy ? 'Updating…' : 'Turn off notifications'}
              </button>
            ) : (
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
                        showToast('Notifications enabled.', 'success');
                      } else {
                        showToast(r.reason ?? 'Could not enable', 'error');
                      }
                    } finally {
                      setPushBusy(false);
                    }
                  })();
                }}
                className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {pushBusy ? 'Enabling…' : 'Enable notifications'}
              </button>
            )}
          </section>
        )}
        {!import.meta.env.PROD && (
          <p className="text-left text-xs text-gray-500 dark:text-gray-400">
            Background push notifications are available in the production build (HTTPS
            + service worker).
          </p>
        )}

        {sso && (
          <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Authelia (this session)
            </h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Username</dt>
                <dd className="text-right font-mono text-xs">{sso.username ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Email</dt>
                <dd className="text-right break-all">{sso.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Display name</dt>
                <dd className="text-right">{sso.display_name ?? '—'}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={saving || !sso.display_name}
                onClick={() => void syncName()}
                className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700"
              >
                Copy display name into app
              </button>
              <button
                type="button"
                disabled={saving || !sso.email}
                onClick={() => void syncEmail()}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                Copy email into app
              </button>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Avatar
          </h2>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shrink-0">
              {displayPic ? (
                <img
                  src={displayPic}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  No photo
                </div>
              )}
            </div>
            <label className="text-sm">
              <span className="sr-only">Upload avatar</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={avatarBusy}
                className="block w-full text-xs text-gray-600 dark:text-gray-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-violet-100 file:text-violet-800 dark:file:bg-violet-950 dark:file:text-violet-200"
                onChange={(e) => void onAvatar(e.target.files?.[0])}
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            JPEG, PNG, or WebP — max {MAX_AVATAR_BYTES / (1024 * 1024)} MB. Square
            images look best in the roster.
          </p>
        </section>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4 text-left">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              App fields
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tap a field to edit; changes save when you leave the field (skill saves
              shortly after you change stars).
            </p>
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Full name</span>
              {editingName ? (
                <input
                  autoFocus
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={() => void saveFullNameBlur()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setFullName(u.full_name ?? '');
                      setEditingName(false);
                    }
                  }}
                  disabled={saving}
                  className="w-full rounded-lg border border-violet-400 dark:border-violet-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditingName(true)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                >
                  {fullName.trim() ? fullName : 'Add name'}
                </button>
              )}
            </div>
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Phone</span>
              {editingPhone ? (
                <input
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => void savePhoneBlur()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setPhone(u.phone ?? '');
                      setEditingPhone(false);
                    }
                  }}
                  disabled={saving}
                  autoComplete="tel"
                  className="w-full rounded-lg border border-violet-400 dark:border-violet-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditingPhone(true)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
                >
                  {phone.trim() ? phone : 'Add phone'}
                </button>
              )}
            </div>
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">
                Self-assessed skill (1–5)
              </span>
              <StarRating
                value={selfAssessed === '' ? 0 : selfAssessed}
                onChange={onSkillChange}
              />
            </label>
            {u.calculated_skill != null && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Calculated skill (from peers + self):{' '}
                <strong className="text-gray-700 dark:text-gray-300">
                  {u.calculated_skill}
                </strong>
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
