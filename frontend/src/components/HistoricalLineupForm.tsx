import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  recordHistoricalSubstitution,
  type MatchSubstitution,
  type MatchSummary,
} from "../api/matchesApi";
import type { MeetupDetail } from "../api/meetupsApi";

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
  const [time, setTime] = useState("");
  const [side, setSide] = useState<"a" | "b">("a");
  const [off, setOff] = useState("");
  const [on, setOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { timeField.current?.focus(); }, []);

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
  const names = new Map(attendees.map((attendee) => [attendee.user_id, attendee.display_name]));
  for (const player of [...match.team_a.users, ...match.team_b.users]) {
    names.set(player.id, player.display_name);
  }
  const onPitch = new Set([...teamA, ...teamB]);
  const incoming = attendees
    .filter((attendee) => attendee.status === "confirmed" && !onPitch.has(attendee.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!off && !on) {
      setError("Select a player to take off or put on.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await recordHistoricalSubstitution(meetupId, match.id, {
        team: side, elapsed_seconds: seconds || null,
        player_off: off ? Number(off) : null, player_on: on ? Number(on) : null,
      });
      onSaved(result.match, result.substitutions);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save the lineup change.");
      setSaving(false);
    }
  }

  const control = "block min-h-12 w-full border border-line bg-raised px-3 py-2 text-base text-ink";
  return (
    <form method="post" onSubmit={submit} aria-labelledby={id} className="border-t border-line pt-3">
      <h4 id={id} className="font-semibold text-ink">Edit match lineup</h4>
      <fieldset disabled={saving} className="mt-3 grid min-w-0 gap-3 disabled:opacity-60 sm:grid-cols-2">
        <legend className="sr-only">Lineup change</legend>
        <div className="min-w-0">
          <label htmlFor={`${id}-time`} className="mb-1 block text-sm text-ink">Elapsed match time</label>
          <input id={`${id}-time`} name="time" type="text" ref={timeField} pattern="[0-9]{1,3}:[0-5][0-9]"
            placeholder="mm:ss" aria-describedby={`${id}-hint`} value={time} className={`${control} tabular-nums`}
            onChange={(event) => { setTime(event.target.value); setOff(""); setOn(""); setError(""); }} />
          <p id={`${id}-hint`} className="mt-1 text-xs text-ink-dim">Use mm:ss, or leave blank to correct the kickoff lineup.</p>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-team`} className="mb-1 block text-sm text-ink">Team</label>
          <select id={`${id}-team`} name="team" value={side} className={control} onChange={(event) => {
            setSide(event.target.value === "b" ? "b" : "a");
            setOff("");
            setError("");
          }}>
            <option value="a">{match.team_a.name}</option>
            <option value="b">{match.team_b.name}</option>
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-off`} className="mb-1 block text-sm text-ink">Player off</label>
          <select id={`${id}-off`} name="player_off" value={off} className={control}
            onChange={(event) => { setOff(event.target.value); setError(""); }}>
            <option value="">No outgoing player</option>
            {(side === "a" ? teamA : teamB).map((uid) => (
              <option key={uid} value={uid}>{names.get(uid) ?? `Player ${uid}`}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-on`} className="mb-1 block text-sm text-ink">Player on</label>
          <select id={`${id}-on`} name="player_on" value={on} className={control}
            onChange={(event) => { setOn(event.target.value); setError(""); }}>
            <option value="">No incoming player</option>
            {incoming.map((player) => (
              <option key={player.user_id} value={player.user_id}>{player.display_name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className="min-h-12 bg-ink px-4 py-2 text-sm font-bold text-board hover:bg-white/90">
            {saving ? "Saving…" : seconds ? "Save substitution" : "Save lineup correction"}
          </button>
          <button type="button" onClick={onCancel}
            className="min-h-12 border border-line px-4 py-2 text-sm text-ink-dim hover:bg-raised hover:text-ink">
            Cancel
          </button>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </form>
  );
}
