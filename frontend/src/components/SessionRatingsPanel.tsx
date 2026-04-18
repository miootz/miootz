import { useCallback, useEffect, useState } from 'react';
import { mediaUrl } from '../api/meApi';
import {
  fetchRatingContext,
  submitRating,
  type RateeContext,
  type RatingContextResponse,
} from '../api/ratingsApi';
import { cacheGet, cachePut } from '../offline/db';
import { cacheKeyRatingContext } from '../offline/cacheKeys';
import { enqueueOutbox, requestBackgroundSync } from '../offline/outbox';
import { useToast } from '../context/ToastContext';
import { StarRating } from './StarRating';

interface SessionRatingsPanelProps {
  sessionId: number;
}

export function SessionRatingsPanel({ sessionId }: SessionRatingsPanelProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratees, setRatees] = useState<RateeContext[]>([]);
  const [editable, setEditable] = useState(false);
  const [beforeStart, setBeforeStart] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState<string | null>(null);
  const [viewerAttended, setViewerAttended] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await fetchRatingContext(sessionId);
      setRatees(ctx.ratees);
      setEditable(ctx.ratings_editable);
      setBeforeStart(ctx.before_session_start);
      setLocked(ctx.ratings_locked);
      setLockHint(ctx.ratings_lock_at);
      setViewerAttended(ctx.viewer_attended ?? true);
      await cachePut(cacheKeyRatingContext(sessionId), ctx);
    } catch (e) {
      const cached = await cacheGet<RatingContextResponse>(
        cacheKeyRatingContext(sessionId)
      );
      const offline =
        typeof navigator !== 'undefined' && !navigator.onLine;
      if (cached?.data && offline) {
        const ctx = cached.data;
        setRatees(ctx.ratees);
        setEditable(ctx.ratings_editable);
        setBeforeStart(ctx.before_session_start);
        setLocked(ctx.ratings_locked);
        setLockHint(ctx.ratings_lock_at);
        setViewerAttended(ctx.viewer_attended ?? true);
        setError('Offline — showing saved ratings.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load ratings');
        setRatees([]);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPick = async (rateeId: number, score: number) => {
    if (!editable) return;
    setSavingId(rateeId);
    setError(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueOutbox({
          type: 'rating',
          sessionId,
          rateeId,
          score,
        });
        await requestBackgroundSync();
        setRatees((prev) =>
          prev.map((r) =>
            r.user_id === rateeId ? { ...r, my_score: score } : r
          )
        );
        showToast('Rating queued — will save when you’re back online.', 'success');
        return;
      }
      await submitRating(sessionId, rateeId, score);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
        Loading ratings…
      </p>
    );
  }

  if (error && ratees.length === 0) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400 py-2">{error}</p>
    );
  }

  if (beforeStart) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
        Ratings open after this session&apos;s start time.
      </p>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {viewerAttended ? (
          <>
            Rate teammates anonymously (1–5). You can change scores until the
            next meetup starts.
            {lockHint && (
              <span className="block mt-1">
                Next lock: {new Date(lockHint).toLocaleString()}
              </span>
            )}
          </>
        ) : (
          <>View-only — you didn&apos;t attend this session.</>
        )}
      </p>
      {viewerAttended && locked && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Ratings for this session are final.
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <ul className="space-y-3">
        {ratees.map((r) => (
          <li
            key={r.user_id}
            className="flex flex-wrap items-center gap-3 justify-between"
          >
            <div className="flex items-center gap-2 min-w-0">
              {r.profile_pic ? (
                <img
                  src={mediaUrl(r.profile_pic) || ''}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover bg-gray-200 dark:bg-gray-700"
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700"
                  aria-hidden
                />
              )}
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                {r.display_name}
              </span>
            </div>
            {viewerAttended ? (
              <StarRating
                value={r.my_score ?? 0}
                onChange={(score) => void onPick(r.user_id, score)}
                size={20}
                readonly={!editable || savingId === r.user_id}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {ratees.length === 0 && (
        <p className="text-sm text-gray-500">
          {viewerAttended
            ? 'No other players to rate.'
            : 'No confirmed players listed.'}
        </p>
      )}
    </div>
  );
}
