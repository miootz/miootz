import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  MAX_AVATAR_BYTES,
  mediaUrl,
  patchMyProfile,
  uploadMyAvatar,
} from '../api/meApi';
import { useAuth } from '../auth/useAuth';
import { StarRating } from '../components/StarRating';

export function ProfilePage() {
  const { me, refresh } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [selfAssessed, setSelfAssessed] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setFullName(me.user.full_name ?? '');
    setPhone(me.user.phone ?? '');
    const sa = me.user.self_assessed_skill ?? me.user.skill_level;
    setSelfAssessed(
      sa != null && sa >= 1 && sa <= 5 ? sa : ''
    );
  }, [me]);

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-600 dark:text-gray-400">Loading profile…</p>
      </div>
    );
  }

  const u = me.user;
  const sso = me.sso;
  const pic = mediaUrl(u.profile_pic);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
      };
      if (selfAssessed) body.self_assessed_skill = selfAssessed;
      await patchMyProfile(body);
      await refresh();
      setMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const syncName = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await patchMyProfile({ sync_display_name_from_sso: true });
      await refresh();
      setMessage('Display name updated from Authelia.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSaving(false);
    }
  };

  const syncEmail = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await patchMyProfile({ sync_email_from_sso: true });
      await refresh();
      setMessage('Email updated from Authelia.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
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
    setAvatarBusy(true);
    setError(null);
    setMessage(null);
    try {
      await uploadMyAvatar(file);
      await refresh();
      setMessage('Avatar updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-lg mx-auto p-6 space-y-8">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            Back to meetup
          </Link>
          <h1 className="mt-4 text-2xl font-bold">Profile</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            App profile is stored here; Authelia is the source for SSO identity.
          </p>
        </div>

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
              {pic ? (
                <img
                  src={pic}
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

        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              App fields
            </h2>
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">Full name</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">Phone</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                autoComplete="tel"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-500">
                Self-assessed skill (1–5)
              </span>
              <StarRating
                value={selfAssessed === '' ? 0 : selfAssessed}
                onChange={(v) => setSelfAssessed(v)}
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
          {message && (
            <p className="text-sm text-green-600 dark:text-green-400">{message}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
