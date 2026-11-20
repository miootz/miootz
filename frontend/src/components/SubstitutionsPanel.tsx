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

export interface PanelTeamUser {
  id: number;
  display_name: string;
  pac?: number | null;
  dri?: number | null;
}

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
 * Pre-start substitutions (admin only). Shows ALL of the meetup's teams —
 * the two playing teams plus the non-playing team(s) — and allows a 1-for-1
 * swap between any two of them, so the bench team is a free pool as well.
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
  onSaved: () => void;
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

  const applySwap = async (
    from: SubstitutionPick<number>,
    to: SubstitutionPick<number>,
  ) => {
    setSaving(true);
    try {
      // 1-for-1 across any two rosters; only the match teams go on the wire.
      const next = rosters.map((r) =>
        r.key === from.key
          ? r.users.map((u) => u.id).filter((id) => id !== from.id).concat(to.id)
          : r.key === to.key
            ? r.users.map((u) => u.id).filter((id) => id !== to.id).concat(from.id)
            : r.users.map((u) => u.id),
      );
      const newA = next[0];
      const newB = next[1];
      await swapMatchTeams(meetupId, match.id, {
        team_a_users: newA,
        team_b_users: newB,
      });
      const nameOf = (id: number) =>
        rosters.flatMap((r) => r.users).find((u) => u.id === id)?.display_name ??
        "?";
      showToast(`${nameOf(from.id)} ↔ ${nameOf(to.id)}`, "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Swap failed", "error");
      // Lease may have lapsed mid-swap — retry acquisition.
      if (!tokenRef.current) void tryAcquire();
    } finally {
      setSaving(false);
    }
  };

  const tapPlayer = (id: number) => {
    if (saving || !holding) return;
    const key = keyOf(id);
    if (!key) return;
    pickSubstitute(selected, { id, key }, setSelected, applySwap);
  };

  const renderTeam = (r: Roster) => (
    <div className="space-y-1.5">
      <div
        className={`flex items-center justify-between px-3 py-2 ${
          r.matchSide === "a"
            ? "bg-team-a text-white"
            : r.matchSide === "b"
              ? "bg-team-b text-white"
              : "bg-raised text-ink-dim"
        }`}
      >
        <span className="text-xs font-bold uppercase tracking-wide truncate">
          {r.name}
        </span>
        <span className="text-xs font-bold tabular-nums">
          {r.users.length}
        </span>
      </div>
      <ul className="divide-y divide-line bg-panel">
        {r.users.map((u) => {
          const isSelected = selected?.id === u.id;
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => tapPlayer(u.id)}
                disabled={saving || !holding}
                className={`w-full min-h-[44px] px-3 py-2 text-left text-sm active:scale-[0.99] transition-transform disabled:opacity-50 ${
                  isSelected
                    ? "bg-live/10 font-semibold text-live"
                    : "text-ink hover:bg-raised"
                }`}
                aria-pressed={isSelected}
              >
                {u.display_name}
                {(u.pac ?? 3) > 3 && <span className="ml-1 text-2xs font-bold text-attribute-pac">PAC</span>}
                {(u.dri ?? 3) > 3 && <span className="ml-1 text-2xs font-bold text-attribute-dri">DRI</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

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
        {rosters.map((r) => renderTeam(r))}
      </div>
      {holding && selected && (
        <p className="text-xs font-medium text-live">
          Tap a player on any other team to swap.
        </p>
      )}
    </section>
  );
}
