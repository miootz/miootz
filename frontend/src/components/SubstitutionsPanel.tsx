import { useCallback, useEffect, useRef, useState } from "react";
import { swapMatchTeams, type MatchSummary } from "../api/matchesApi";
import {
  acquireLease,
  releaseLease,
  renewLease,
} from "../api/stewardApi";
import {
  leaseCountdown,
  leaseFromExpiresIn,
  type LeaseInfo,
} from "../utils/lease";
import { useToast } from "../context/ToastContext";
import { Loader2 } from "lucide-react";
import { pickSubstitute, type SubstitutionPick } from "../utils/substitutionSelection";

import { SubstitutionRoster, type SubstitutionPlayer as PanelTeamUser } from "./SubstitutionRoster";

export interface ExtraTeam {
  name: string;
  users: PanelTeamUser[];
}

interface Roster {
  key: string;
  name: string;
  /** "a" | "b" for the two playing teams; null for a non-playing team. */
  matchSide: "a" | "b" | null;
  users: PanelTeamUser[];
}

/**
 * Admin substitutions before kickoff and while the clock is paused.
 *
 * One-writer: the panel holds the match editor lease while open
 * (acquire on open, renew every 20 s, release on close) — the same
 * lock the referee uses for goal entry. Whoever opens first edits;
 * the second sees a named holder with a countdown.
 */
export function SubstitutionsPanel({
  meetupId,
  match,
  onSaved,
  extraTeams = [],
}: {
  meetupId: number;
  match: MatchSummary;
  onSaved: () => Promise<void>;
  extraTeams?: ExtraTeam[];
}) {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<SubstitutionPick<number> | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  // ── Lease lifecycle: acquire on open, renew while open, release on close ─
  const tokenRef = useRef<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [busy, setBusy] = useState<LeaseInfo | null>(null);
  const [busyLeft, setBusyLeft] = useState(0);

  const tryAcquire = useCallback(async (): Promise<boolean> => {
    setAcquiring(true);
    try {
      const res = await acquireLease(meetupId, match.id);
      if (res.ok) {
        tokenRef.current = res.lease.lease_token;
        setHolding(true);
        setBusy(null);
        return true;
      }
      setHolding(false);
      setBusy(
        leaseFromExpiresIn(res.busy.holder_name, res.busy.expires_in),
      );
      return false;
    } catch (e) {
      setHolding(false);
      showToast(
        e instanceof Error ? e.message : "Could not reach the server",
        "error",
      );
      return false;
    } finally {
      setAcquiring(false);
    }
  }, [meetupId, match.id, showToast]);

  useEffect(() => {
    void tryAcquire();
    const renewTimer = setInterval(() => {
      if (!tokenRef.current) return;
      void (async () => {
        const res = await renewLease(meetupId, tokenRef.current!, match.id);
        if (res.ok) {
          setHolding(true);
          setBusy(null);
        } else {
          setHolding(false);
          setBusy(
            leaseFromExpiresIn(res.busy.holder_name, res.busy.expires_in),
          );
        }
      })();
    }, 20_000);
    return () => {
      clearInterval(renewTimer);
      if (tokenRef.current)
        void releaseLease(meetupId, tokenRef.current, match.id);
      tokenRef.current = null;
    };
  }, [meetupId, match.id, tryAcquire]);

  // Busy countdown (wall-clock derived); on expiry, try to take over.
  useEffect(() => {
    if (!busy) return;
    const tick = () => {
      const left = leaseCountdown(busy);
      if (left <= 0) {
        setBusy(null);
        setBusyLeft(0);
        void tryAcquire();
      } else {
        setBusyLeft(left);
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [busy, tryAcquire]);

  const rosters: Roster[] = [
    {
      key: "a",
      name: match.team_a.name,
      matchSide: "a",
      users: match.team_a.users,
    },
    {
      key: "b",
      name: match.team_b.name,
      matchSide: "b",
      users: match.team_b.users,
    },
    ...extraTeams.map((t, i) => ({
      key: `x${i}`,
      name: t.name,
      matchSide: null,
      users: t.users,
    })),
  ];

  // Rosters changed (swap applied elsewhere) — drop a stale selection.
  useEffect(() => {
    setSelected(null);
  }, [match.id, match.team_a.users, match.team_b.users]);

  const keyOf = (id: number): string | null =>
    rosters.find((r) => r.users.some((u) => u.id === id))?.key ?? null;

  const saveTeams = async (body: Parameters<typeof swapMatchTeams>[2], message: string) => {
    setSaving(true);
    try {
      await swapMatchTeams(meetupId, match.id, body);
      setSelected(null);
      showToast(message, "success");
      await onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not update the lineup", "error");
      // Lease may have lapsed mid-swap — retry acquisition.
      if (!tokenRef.current) void tryAcquire();
    } finally {
      setSaving(false);
    }
  };

  const applySwap = (from: SubstitutionPick<number>, to: SubstitutionPick<number>) => {
    const swap = (team: Roster) => {
      const ids = team.users.map(({ id }) => id);
      if (team.key === from.key) return ids.filter((id) => id !== from.id).concat(to.id);
      if (team.key === to.key) return ids.filter((id) => id !== to.id).concat(from.id);
      return ids;
    };
    const nameOf = (id: number) => rosters.flatMap((r) => r.users).find((u) => u.id === id)?.display_name;
    return saveTeams(
      { team_a_users: swap(rosters[0]), team_b_users: swap(rosters[1]) },
      `${nameOf(from.id)} ↔ ${nameOf(to.id)}`,
    );
  };

  const addPlayer = (player: PanelTeamUser, side: "a" | "b", teamName: string) => {
    const teamA = match.team_a.users.map(({ id }) => id);
    const teamB = match.team_b.users.map(({ id }) => id);
    (side === "a" ? teamA : teamB).push(player.id);
    return saveTeams(
      { team_a_users: teamA, team_b_users: teamB, add_sideline_player: true },
      `${player.display_name} added to ${teamName}`,
    );
  };

  const tapPlayer = (id: number) => {
    if (saving || !holding) return;
    const key = keyOf(id);
    if (!key) return;
    pickSubstitute(selected, { id, key }, setSelected, applySwap);
  };

  return (
    <section className="border border-line bg-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim">
          Substitutions
        </h3>
        {acquiring && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-live" aria-hidden />
        )}
      </div>

      {/* One-writer state — named, never silent */}
      {busy && (
        <p className="border border-live/40 bg-live/10 px-3 py-2 text-sm font-medium text-ink tabular-nums">
          {busy.holderName} is editing substitutions… {busyLeft}s
        </p>
      )}

      <div className={`grid grid-cols-2 gap-3 ${busy ? "opacity-50" : ""}`}>
        {rosters.map((roster) => (
          <SubstitutionRoster key={roster.key} name={roster.name} side={roster.matchSide}
            players={roster.users} selectedId={selected?.id} disabled={saving || !holding}
            onPick={tapPlayer} actions={roster.matchSide === null ? (player) => !player.inAnotherMatch && (
              <div className="grid grid-cols-2 gap-2 px-2 pb-2">
                {(["a", "b"] as const).map((side, index) => (
                  <button key={side} type="button" disabled={saving || !holding}
                    aria-label={`Add ${player.display_name} to ${rosters[index].name}`}
                    onClick={() => void addPlayer(player, side, rosters[index].name)}
                    className="min-h-12 min-w-0 break-words border border-line px-2 py-2 text-sm font-semibold text-ink hover:bg-raised disabled:opacity-50">
                    Add to {rosters[index].name}
                  </button>
                ))}
              </div>
            ) : undefined} />
        ))}
      </div>
      {holding && selected && (
        <p className="text-xs font-medium text-live">
          Tap a player on any other team to swap.
        </p>
      )}
    </section>
  );
}
