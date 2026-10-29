import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { MeetupDetails } from "./MeetupDetails";
import type { Meetup, User, Team } from "../types";
import {
  fetchMeetups,
  fetchMeetupDetail,
  fetchMeetupTeams,
  type MeetupDetail,
} from "../api/meetupsApi";
import { mediaUrl } from "../api/meApi";
import { clearMeetupChatCache } from "../stores/meetupChatCache";
import { recordMeetupView } from "../offline/engagement";
import {
  loadMeetupSnapshot,
  saveMeetupSnapshot,
} from "../offline/meetupSnapshot";
import { parseMeetupStart } from "../utils/datetime";
import { subscribeMeetupData } from "../utils/meetupDataBus";
import { useMemberShell } from "../context/MemberShellContext";
import { MeetupDetailsSkeleton } from "../components/MeetupDetailsSkeleton";
import { OnboardingCard } from "../components/OnboardingCard";
import { useAuth } from "../auth/useAuth";

function mapDetailToMeetup(detail: MeetupDetail, teams: Team[]): Meetup {
  const start = detail.start_time;
  const date =
    start.length >= 10
      ? start.slice(0, 10)
      : parseMeetupStart(start).toISOString().slice(0, 10);
  const attendance: User[] = detail.attendees
    .filter((a: MeetupDetail["attendees"][number]) => a.status !== "cancelled")
    .map((a: MeetupDetail["attendees"][number]) => ({
      id: String(a.user_id),
      name: a.display_name,
      skillScore: Math.round(a.skill),
      isLocked: false,
      avatarUrl: mediaUrl(a.avatar_url ?? undefined),
      attendanceStatus: a.status === "waitlisted" ? "waitlisted" : "confirmed",
      isPlusOne: a.is_plus_one ?? false,
      primarySpecialty: a.primary_specialty ?? null,
      secondarySpecialty: a.secondary_specialty ?? null,
    }));
  const ma = detail.my_attendance;
  return {
    id: String(detail.id),
    date,
    startTime: start,
    attendance,
    teams,
    location: detail.location,
    latitude: detail.latitude,
    longitude: detail.longitude,
    fee: detail.fee,
    minPlayers: detail.min_players,
    maxPlayers: detail.max_players,
    myAttendance:
      ma === "confirmed" || ma === "waitlisted" || ma === "cancelled"
        ? ma
        : null,
    teamAssignmentMode:
      detail.team_assignment_mode === "random" ? "random" : "balanced",
    myWaitlistPosition: detail.my_waitlist_position ?? null,
  };
}

export function PlayerApp() {
  const { setHeader } = useMemberShell();
  const { me, tokens } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meetup, setMeetup] = useState<Meetup | null>(null);
  const [activeMeetupNumericId, setActiveMeetupNumericId] = useState<
    number | null
  >(null);
  const [rosterChannelLive, setRosterChannelLive] = useState(false);
  const [lastRosterSync, setLastRosterSync] = useState<Date | null>(null);
  const [nextAnnounceAt, setNextAnnounceAt] = useState<string | null>(null);
  const [offlineDataUpdatedAt, setOfflineDataUpdatedAt] = useState<Date | null>(
    null,
  );

  const loadMeetup = useCallback(async (meetupId: number) => {
    const [detail, teamsRes] = await Promise.all([
      fetchMeetupDetail(meetupId),
      fetchMeetupTeams(meetupId),
    ]);
    const t = teamsRes.teams.map((x) => ({
      id: x.id,
      name: x.name ?? `Team ${x.id.replace("t", "")}`,
      players: x.players.map((p) => ({
        id: p.id,
        name: p.name,
        skillScore: p.skillScore,
        isLocked: p.isLocked,
        avatarUrl: mediaUrl(p.profilePic ?? undefined),
        primarySpecialty: p.primarySpecialty ?? null,
        secondarySpecialty: p.secondarySpecialty ?? null,
      })),
    }));
    const mapped = mapDetailToMeetup(detail, t);
    setMeetup(mapped);
    setActiveMeetupNumericId(meetupId);
    setLastRosterSync(new Date());
    setOfflineDataUpdatedAt(null);
    void saveMeetupSnapshot(mapped);
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const upcomingRes = await fetchMeetups({
        status: "upcoming",
        order: "asc",
        limit: 50,
      });
      const upcoming = upcomingRes.items;
      if (upcoming.length === 0) {
        await clearMeetupChatCache();
        setMeetup(null);
        setActiveMeetupNumericId(null);
        setOfflineDataUpdatedAt(null);
        setNextAnnounceAt(null);
        const anyRes = await fetchMeetups({
          status: "all",
          order: "desc",
          limit: 5,
        });
        if (anyRes.total === 0) {
          setError("No meetups yet. Create one in Admin.");
        } else {
          setNextAnnounceAt(
            anyRes.items.find((s) => s.game_template?.next_announce_at)
              ?.game_template?.next_announce_at ?? null,
          );
          setError(null);
        }
        return;
      }
      await loadMeetup(upcoming[0].id);
      recordMeetupView();
    } catch (e) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline) {
        const snap = await loadMeetupSnapshot();
        if (snap) {
          setMeetup(snap.meetup);
          setActiveMeetupNumericId(Number.parseInt(snap.meetup.id, 10));
          setOfflineDataUpdatedAt(new Date(snap.updatedAt));
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } else {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, [loadMeetup]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // Existing meetup-data SSE plumbing, now behind the shared hub
  // (utils/meetupDataBus): LiveMatchBanner (scoreboard/goals) subscribes
  // through the SAME physical connection — no second EventSource.
  useEffect(() => {
    if (activeMeetupNumericId == null) {
      setRosterChannelLive(false);
      return;
    }
    return subscribeMeetupData(
      activeMeetupNumericId,
      tokens?.accessToken,
      (data) => {
        if (
          data.type === "meetup_updated" &&
          data.meetup_id === activeMeetupNumericId
        ) {
          void loadMeetup(activeMeetupNumericId);
        }
        if (
          data.type === "meetup_deleted" &&
          data.meetup_id === activeMeetupNumericId
        ) {
          void clearMeetupChatCache().then(() => loadInitialData());
        }
      },
      setRosterChannelLive,
    );
  }, [activeMeetupNumericId, loadMeetup, loadInitialData, tokens?.accessToken]);

  useEffect(() => {
    if (loading || !meetup) {
      setHeader(null);
      return;
    }
    let line1: string;
    if (meetup.startTime) {
      const k = parseMeetupStart(meetup.startTime);
      line1 = Number.isNaN(k.getTime())
        ? meetup.date
        : format(k, "EEE d MMM · HH:mm");
    } else {
      try {
        const d = parseISO(meetup.date);
        line1 = Number.isNaN(d.getTime())
          ? meetup.date
          : format(d, "EEE d MMM");
      } catch {
        line1 = meetup.date;
      }
    }
    setHeader({
      line1,
      location: meetup.location || undefined,
      fee: meetup.fee ?? undefined,
      meetupId: activeMeetupNumericId ?? undefined,
      sseLive: rosterChannelLive,
    });
    return () => setHeader(null);
  }, [meetup, loading, setHeader, activeMeetupNumericId, rosterChannelLive]);

  return (
    <>
      {loading && <MeetupDetailsSkeleton />}
      {error && !loading && (
        <p className="mx-auto max-w-lg p-8 text-center text-danger">
          {error}
        </p>
      )}
      {!loading && !meetup && !error && (
        <p className="mx-auto max-w-lg p-8 text-center text-ink-dim">
          {nextAnnounceAt
            ? `Next meetup coming soon — signups open ${format(
                new Date(nextAnnounceAt),
                "EEEE, HH:mm",
              )}`
            : "No upcoming meetup. Past meetups are in History."}
        </p>
      )}
      {!loading && meetup && (
        <>
          <div className="mx-auto max-w-6xl px-4 pt-4">
            <OnboardingCard userId={me?.user.pocket_id_sub ?? "anon"} />
          </div>
          <MeetupDetails
            meetup={meetup}
            rosterChannelLive={rosterChannelLive}
            lastRosterSync={lastRosterSync}
            offlineDataUpdatedAt={offlineDataUpdatedAt}
            onRosterUpdated={() =>
              activeMeetupNumericId != null &&
              void loadMeetup(activeMeetupNumericId)
            }
          />
        </>
      )}
    </>
  );
}
