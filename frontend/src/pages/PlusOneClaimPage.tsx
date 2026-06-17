import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { checkPlusOneClaim, claimPlusOne } from '../api/sessionsApi';
import { useToast } from '../context/ToastContext';
import { hapticError, hapticSuccess } from '../utils/haptics';
import { UserPlus, CheckCircle, AlertCircle } from 'lucide-react';

export const PlusOneClaimPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  const [guestInfo, setGuestInfo] = useState<{
    first_name: string;
    last_name: string;
    self_assessed_skill: number;
    inviter_username: string;
    guest_username: string;
  } | null>(null);

  const [username, setUsername] = useState('');
  // phone field removed — users manage identity via Pocket ID
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('No claim token provided.');
      setLoading(false);
      return;
    }
    void checkPlusOneClaim(token)
      .then((data) => {
        if (data.status === 'claimed') {
          setClaimed(true);
        } else {
          setGuestInfo({
            first_name: data.first_name,
            last_name: data.last_name,
            self_assessed_skill: data.self_assessed_skill,
            inviter_username: data.inviter_username,
            guest_username: data.guest_username,
          });
          // Pre-fill username suggestion
          setUsername(
            `${data.first_name.toLowerCase()}${data.last_name.toLowerCase()}`.replace(/[^a-z0-9]/g, '')
          );
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Invalid claim link');
        setLoading(false);
      });
  }, [token]);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !guestInfo) return;

    const cleanUsername = username.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (cleanUsername.length < 2) {
      setError('Username must be at least 2 characters (letters, numbers, underscores).');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const result = await claimPlusOne(token, {
        username: cleanUsername,
      });
      hapticSuccess();
      showToast(`Welcome, ${result.username}! You've claimed your spot.`, 'success');
      setClaimed(true);
      // Auto-redirect to the main app after a short delay
      setTimeout(() => navigate('/'), 2000);
    } catch (e) {
      hapticError();
      const msg = e instanceof Error ? e.message : 'Failed to claim';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="animate-spin mx-auto w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (error && !guestInfo) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="text-center space-y-4 max-w-sm">
          <AlertCircle className="mx-auto text-red-500" size={40} />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Invalid Claim Link
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="text-center space-y-4 max-w-sm">
          <CheckCircle className="mx-auto text-emerald-500" size={48} />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Already Claimed
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This plus-one spot has already been claimed.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (!guestInfo) return null;

  return (
    <div className="flex items-center justify-center min-h-[80vh] p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-5 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-violet-100 dark:bg-violet-900/30">
            <UserPlus className="text-violet-600 dark:text-violet-400" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Claim Your Spot
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              You were invited by{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {guestInfo.inviter_username}
              </span>
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Name</span>
            <span className="text-gray-900 dark:text-white font-medium">
              {guestInfo.first_name} {guestInfo.last_name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Skill level</span>
            <span className="text-gray-900 dark:text-white font-medium">
              {guestInfo.self_assessed_skill}/5
            </span>
          </div>
        </div>

        <form onSubmit={handleClaim} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Choose a username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="yourname"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              maxLength={40}
              pattern="[a-zA-Z0-9_]+"
              required
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Letters, numbers, and underscores only
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1" role="alert">
              <AlertCircle size={14} />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full px-4 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 active:scale-[0.98]"
          >
            {busy ? 'Claiming…' : 'Claim my spot'}
          </button>
        </form>
      </div>
    </div>
  );
};
