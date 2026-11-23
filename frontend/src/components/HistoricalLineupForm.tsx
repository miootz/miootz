import { useEffect, useId, useRef, useState } from "react";
import {
  recordHistoricalSubstitution,
  type MatchSubstitution,
  type MatchSummary,
} from "../api/matchesApi";
import type { MeetupDetail } from "../api/meetupsApi";
import { pickSubstitute, type SubstitutionPick } from "../utils/substitutionSelection";
import { SubstitutionRoster, type SubstitutionPlayer } from "./SubstitutionRoster";

export function HistoricalLineupForm({ meetupId, match, substitutions, attendees, onSaved, onCancel }: {
  meetupId: number;
  match: MatchSummary;
  substitutions: MatchSubstitution[];
  attendees: MeetupDetail["attendees"];
  onSaved: (match: MatchSummary, substitutions: MatchSubstitution[]) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const timeField = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [time, setTime] = useState("");
  const [selected, setSelected] = useState<SubstitutionPick<number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { heading.current?.focus(); }, []);

  const parts = time.match(/^([0-9]{1,3}):([0-5][0-9])$/);
  const seconds = parts ? Number(parts[1]) * 60 + Number(parts[2]) : 0;
  const timed = substitutions
    .filter((sub) => sub.clock_secs != null)
    .sort((a, b) => (a.clock_secs ?? 0) - (b.clock_secs ?? 0) || a.id - b.id);
  const prior = seconds > 0 ? timed.findLast((sub) => (sub.clock_secs ?? 0) <= seconds) : undefined;
  let teamA = match.team_a.users.map((player) => player.id);
  let teamB = match.team_b.users.map((player) => player.id);
  if (prior) {
    teamA = prior.new_team_a_users;
    teamB = prior.new_team_b_users;
  } else if (timed.length) {
    teamA = timed[0].old_team_a_users;
    teamB = timed[0].old_team_b_users;
  }
  const players = new Map<number, SubstitutionPlayer>(
    attendees.map((attendee) => [attendee.user_id, { ...attendee, id: attendee.user_id }]),
  );
  for (const player of [...match.team_a.users, ...match.team_b.users]) {
    players.set(player.id, player);
  }
  const onPitch = new Set([...teamA, ...teamB]);
  const incoming = attendees
    .filter((attendee) => attendee.status === "confirmed" && !onPitch.has(attendee.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const rosters = [
    { key: "a", side: "a", name: match.team_a.name, ids: teamA },
    { key: "b", side: "b", name: match.team_b.name, ids: teamB },
    { key: "bench", side: null, name: "Bench", ids: incoming.map((player) => player.user_id) },
  ] as const;

  async function save(side: "a" | "b", off: number | null, on: number | null, swapTeams = false) {
    if (saving || !timeField.current?.reportValidity()) return;
    setSaving(true);
    setError("");
    try {
      const result = await recordHistoricalSubstitution(meetupId, match.id, {
        team: side, elapsed_seconds: seconds || null,
        player_off: off, player_on: on, swap_teams: swapTeams,
      });
      setSelected(null);
      onSaved(result.match, result.substitutions);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save the lineup change.");
    } finally {
      setSaving(false);
    }
  }

  function swap(first: SubstitutionPick<number>, second: SubstitutionPick<number>) {
    const [onPitch, other] = first.key === "bench" ? [second, first] : [first, second];
    void save(onPitch.key === "a" ? "a" : "b", onPitch.id, other.id, other.key !== "bench");
  }
  const actionClass = "min-h-12 min-w-0 break-words border border-line px-2 py-2 text-sm font-medium text-ink hover:bg-raised disabled:opacity-60";
  return (
    <section aria-labelledby={id} className="space-y-3 border border-live/40 bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 ref={heading} id={id} tabIndex={-1} className="font-semibold text-ink">Edit match lineup</h4>
        <button type="button" onClick={onCancel} disabled={saving} className={actionClass}>Done</button>
      </div>
      <div>
        <label htmlFor={`${id}-time`} className="mb-1 block text-sm text-ink">Elapsed match time</label>
        <input id={`${id}-time`} type="text" ref={timeField} pattern="[0-9]{1,3}:[0-5][0-9]"
          placeholder="mm:ss" aria-describedby={`${id}-hint`} value={time} disabled={saving}
          className="block min-h-12 w-full max-w-40 border border-line bg-raised px-3 py-2 text-base tabular-nums text-ink"
          onChange={(event) => { setTime(event.target.value); setSelected(null); setError(""); }} />
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-dim">Use mm:ss, or leave blank to correct the kickoff lineup.</p>
      </div>
      <p role="status" className="text-sm text-ink-dim">
        {saving ? "Saving lineup…" : selected ? "Tap a player on another team or the bench to swap." : "Tap two players on different teams or the bench to swap them."}
      </p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        {rosters.map(({ key, name, side, ids }) => (
          <SubstitutionRoster key={key} name={name} side={side}
            players={ids.map((uid) => players.get(uid) ?? { id: uid, display_name: `Player ${uid}` })}
            selectedId={selected?.id} disabled={saving}
            onPick={(uid) => pickSubstitute(selected, { key, id: uid }, setSelected, swap)}
            actions={(player) => side ? (
              <button type="button" disabled={saving} className={`w-full ${actionClass}`}
                onClick={() => void save(side, player.id, null)}>Move to bench</button>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-2">
                <button type="button" disabled={saving} className={actionClass}
                  onClick={() => void save("a", null, player.id)}>Add to {match.team_a.name}</button>
                <button type="button" disabled={saving} className={actionClass}
                  onClick={() => void save("b", null, player.id)}>Add to {match.team_b.name}</button>
              </div>
            )} />
        ))}
      </div>
    </section>
  );
}
