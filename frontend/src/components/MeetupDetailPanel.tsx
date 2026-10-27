import { parseMeetupStart } from "../utils/datetime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, MapPin, MessageSquare, Trophy } from "lucide-react";
import type { User } from "../types";
import { fetchMeetupTeams, type TeamsResponse } from "../api/meetupsApi";
import {
  fetchRatingContext,
  submitRating,
  type RateeContext,
} from "../api/ratingsApi";
import { TeamRoster } from "./TeamRoster";
import { MatchHistoryList } from "./MatchHistoryList";
import { RecordedWeatherBadge } from "./MeetupWeatherBadge";
import { useToast } from "../context/ToastContext";
import { apiFetch } from "../api/client";
import {
  groupMessages,
  formatDateHeader,
  formatCompactTime,
} from "../utils/chat";
import { Avatar } from "./Avatar";
import { useAuth } from "../auth/useAuth";

/* ── Team player → User mapping ───────────────────────── */

function mapTeamPlayers(team: TeamsResponse["teams"][0]): User[] {
  return team.players.map((p) => ({
    id: p.id,
    name: p.name,
    skillScore: p.skillScore,
    isLocked: p.isLocked,
    avatarUrl: p.profilePic ?? undefined,
    primarySpecialty: p.primarySpecialty ?? undefined,
    secondarySpecialty: p.secondarySpecialty ?? undefined,
    calculatedSkill: p.calculatedSkill ?? null,
  }));
}

/* ── Chat history (read-only) ─────────────────────────── */

interface ChatMsg {
  id: number;
  user_id: number;
  username: string;
  message: string;
  created_at: string;
  avatar_url: string | null;
  username_color: string;
}

function ChatHistorySection({ meetupId }: { meetupId: number }) {
  const { me } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Initial loading state for the fetch-on-mount pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiFetch(`/meetups/${meetupId}/chat`)
      .then((r) => r.json() as Promise<ChatMsg[]>)
      .then((data) => {
        if (!cancelled) setMessages(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meetupId]);

  if (loading) return null;
  if (messages.length === 0) return null;

  const grouped = groupMessages(
    messages.map((m) => ({
      id: m.id,
      userId: m.user_id,
      username: m.username,
      usernameColor: m.username_color,
      avatarUrl: m.avatar_url,
      text: m.message,
      time: parseMeetupStart(m.created_at),
    })),
    me?.user?.id ?? null,
  );

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
        <MessageSquare className="h-4 w-4" aria-hidden />
        Chat history
        <span className="text-2xs font-normal text-gray-500 dark:text-gray-400 ml-auto">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </span>
      </h2>
      <div className="space-y-4">
        {grouped.map((group) => {
          const firstMsg = group.messages[0];
          return (
            <div key={group.messages[0].id} className="space-y-1">
              {group.showHeader && (
                <div className="flex items-center gap-2 mt-1">
                  <Avatar
                    url={group.avatarUrl ?? undefined}
                    username={group.username}
                    size="sm"
                  />
                  <span
                    className="text-xs font-medium"
                    style={{ color: group.usernameColor }}
                  >
                    {group.username}
                  </span>
                  <span className="text-2xs text-gray-500 dark:text-gray-400">
                    {formatDateHeader(firstMsg.time)}
                  </span>
                </div>
              )}
              {group.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-3 py-1.5 rounded-2xl text-sm max-w-[85%] ${
                    group.isMine
                      ? "bg-teal-100 dark:bg-teal-900/40 text-teal-900 dark:text-teal-100 ml-auto"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                  }`}
                >
                  <p className="break-words whitespace-pre-wrap">{msg.text}</p>
                  <span className="block text-2xs opacity-50 mt-0.5 text-right">
                    {formatCompactTime(msg.time)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Main panel ───────────────────────────────────────── */

export function MeetupDetailPanel({
  meetupId,
  meetupLocation,
  meetupTime,
  meetupFee,
}: {
  meetupId: number;
  meetupLocation?: string;
  meetupTime?: string;
  meetupFee?: number;
}) {
  const { showToast } = useToast();
  const [teams, setTeams] = useState<TeamsResponse["teams"] | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [ratees, setRatees] = useState<RateeContext[]>([]);
  const [ratingsEditable, setRatingsEditable] = useState(false);
  const [ratingsLocked, setRatingsLocked] = useState(false);
  const [viewerAttended, setViewerAttended] = useState(true);
  const [weatherData, setWeatherData] = useState<{
    temperature_c: number;
    weather_code: number | null;
    label: string | null;
  } | null>(null);

  const canRate = viewerAttended && !ratingsLocked && ratingsEditable;

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    try {
      const res = await fetchMeetupTeams(meetupId);
      setTeams(res.teams);
    } catch {
      setTeams(null);
    } finally {
      setTeamsLoading(false);
    }
  }, [meetupId]);

  const loadRatings = useCallback(async () => {
    try {
      const ctx = await fetchRatingContext(meetupId);
      setRatees(ctx.ratees);
      setRatingsEditable(ctx.ratings_editable);
      setRatingsLocked(ctx.ratings_locked);
      setViewerAttended(ctx.viewer_attended ?? true);
    } catch {
      setRatees([]);
    }
  }, [meetupId]);

  const loadWeather = useCallback(async () => {
    if (Number.isNaN(meetupId)) return;
    try {
      const r = await apiFetch(`/meetups/${meetupId}/weather`);
      if (!r.ok) return;
      const data = await r.json();
      if (data.recorded) {
        setWeatherData({
          temperature_c: data.recorded.temperature_c,
          weather_code: data.recorded.weather_code,
          label: data.recorded.label,
        });
      }
    } catch {
      // ignore
    }
  }, [meetupId]);

  useEffect(() => {
    void Promise.all([loadTeams(), loadRatings(), loadWeather()]);
  }, [loadTeams, loadRatings, loadWeather]);

  // Build a lookup: player id → my_score
  const scoreMap = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const r of ratees) {
      // Match ratees to players by user_id; we need the string id
      const playerId = String(r.user_id);
      m[playerId] = r.my_score != null && r.my_score > 0 ? r.my_score : null;
    }
    return m;
  }, [ratees]);

  // Build a lookup: player id → ratee user_id (for API calls)
  const rateeIdMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of ratees) {
      m[String(r.user_id)] = r.user_id;
    }
    return m;
  }, [ratees]);

  const handleRatingChange = useCallback(
    async (playerId: string, score: number) => {
      if (!canRate) return;
      const rateeId = rateeIdMap[playerId];
      if (!rateeId) {
        showToast("Couldn't find player to rate", "error");
        return;
      }

      try {
        await submitRating(meetupId, rateeId, score);
        setRatees((prev) =>
          prev.map((r) =>
            r.user_id === rateeId ? { ...r, my_score: score } : r,
          ),
        );
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Rating failed", "error");
      }
    },
    [canRate, rateeIdMap, meetupId, showToast],
  );

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* ── Meetup details ──────────────────────────────── */}
      {(meetupLocation ||
        meetupTime ||
        meetupFee != null ||
        weatherData) && (
        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Meetup details
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {meetupTime && (
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <span>{meetupTime}</span>
              </div>
            )}
            {meetupLocation && (
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <span className="truncate">{meetupLocation}</span>
              </div>
            )}
            {meetupFee != null && meetupFee > 0 && (
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                <span className="text-gray-400">$</span>
                <span className="tabular-nums">{meetupFee.toFixed(0)}</span>
              </div>
            )}
            {weatherData && weatherData.temperature_c != null && (
              <div className="flex items-center gap-1.5">
                <RecordedWeatherBadge
                  temperature_c={weatherData.temperature_c}
                  weather_code={weatherData.weather_code ?? null}
                  label={weatherData.label ?? null}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Teams on pitch ─────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
          <Trophy className="h-4 w-4" aria-hidden />
          Teams
          {canRate && (
            <span className="text-2xs font-normal text-teal-700 dark:text-teal-400 ml-auto">
              Rate players below
            </span>
          )}
          {viewerAttended && ratingsLocked && (
            <span className="text-2xs font-normal text-gray-500 dark:text-gray-400 ml-auto">
              Ratings final
            </span>
          )}
        </h2>

        {teamsLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading teams…
          </div>
        ) : teams && teams.length > 0 ? (
          <div className="space-y-3">
            {teams.map((team) => {
              const players = mapTeamPlayers(team);
              return (
                <div key={team.id} className="space-y-1.5">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 text-center">
                    {team.name ?? team.id}
                    <span className="text-gray-400 font-normal ml-1">
                      ({players.length})
                    </span>
                  </div>
                  <TeamRoster
                    players={players}
                    ratingMode={canRate ? "inline" : "none"}
                    ratingScores={canRate ? scoreMap : undefined}
                    onRatingChange={canRate ? handleRatingChange : undefined}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            No teams recorded for this meetup.
          </p>
        )}
      </section>

      {/* ── Match results ──────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
          <Trophy className="h-4 w-4" aria-hidden />
          Match results
        </h2>
        <MatchHistoryList meetupId={meetupId} />
      </section>

      {/* ── Chat history ──────────────────────────────── */}
      <ChatHistorySection meetupId={meetupId} />
    </div>
  );
}
