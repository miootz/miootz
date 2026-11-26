import {
  COMMON_TIMEZONES,
  inferRecurrenceWallTime,
  WEEKDAY_LABELS,
} from '../utils/recurrence';
import { ToggleSwitch } from "./ToggleSwitch";

type Props = {
  startLocal: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** e.g. "Schedule active" on template pages vs "Repeat weekly" on meetups */
  scheduleToggleLabel?: string;
  /** Hide "Match start time above" (no meetup start field on template admin). */
  hideMatchStartButton?: boolean;
  /** Replaces the note under meetup time (meetup vs template copy). */
  kickoffHelperText?: string;
  /** Kickoff (meetup) each week */
  timezone: string;
  onTimezoneChange: (v: string) => void;
  weekday: number;
  onWeekdayChange: (v: number) => void;
  hour: number;
  onHourChange: (v: number) => void;
  minute: number;
  onMinuteChange: (v: number) => void;
  /** When each week to create the next meetup + send join-link pushes */
  announceTimezone: string;
  onAnnounceTimezoneChange: (v: string) => void;
  announceWeekday: number;
  onAnnounceWeekdayChange: (v: number) => void;
  announceHour: number;
  onAnnounceHourChange: (v: number) => void;
  announceMinute: number;
  onAnnounceMinuteChange: (v: number) => void;
};

const fieldClass =
  'w-full border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live';
const labelClass = 'block text-xs font-medium text-ink-dim mb-1';

export function AdminMeetupRecurrenceForm({
  startLocal,
  enabled,
  onEnabledChange,
  scheduleToggleLabel = 'Repeat weekly',
  hideMatchStartButton = false,
  kickoffHelperText = 'Must match the meetup start time field.',
  timezone,
  onTimezoneChange,
  weekday,
  onWeekdayChange,
  hour,
  onHourChange,
  minute,
  onMinuteChange,
  announceTimezone,
  onAnnounceTimezoneChange,
  announceWeekday,
  onAnnounceWeekdayChange,
  announceHour,
  onAnnounceHourChange,
  announceMinute,
  onAnnounceMinuteChange,
}: Props) {
  function syncKickoffFromStart() {
    const t = inferRecurrenceWallTime(startLocal, timezone);
    if (!t) return;
    onWeekdayChange(t.weekday);
    onHourChange(t.hour);
    onMinuteChange(t.minute);
  }

  function copyAnnounceFromKickoff() {
    onAnnounceTimezoneChange(timezone);
    onAnnounceWeekdayChange(weekday);
    onAnnounceHourChange(hour);
    onAnnounceMinuteChange(minute);
  }

  return (
    <div className="border border-line bg-panel p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <ToggleSwitch
            enabled={enabled}
            onChange={() => onEnabledChange(!enabled)}
            ariaLabel={scheduleToggleLabel}
          />
          <span className="text-sm font-medium text-ink">
            {scheduleToggleLabel}
          </span>
        </div>
      </div>

      {enabled ? (
        <>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-ink">
                Meetup time (each week)
              </h3>
              {!hideMatchStartButton ? (
                <button
                  type="button"
                  onClick={syncKickoffFromStart}
                  className="text-xs font-medium text-ink-dim hover:text-ink hover:underline"
                >
                  Match start time above
                </button>
              ) : null}
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {kickoffHelperText}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelClass}>Timezone (IANA)</label>
                <input
                  type="text"
                  list="tz-presets-kickoff"
                  value={timezone}
                  onChange={(e) => onTimezoneChange(e.target.value)}
                  placeholder="Europe/London"
                  className={fieldClass}
                />
                <datalist id="tz-presets-kickoff">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={labelClass}>Weekday</label>
                <select
                  value={weekday}
                  onChange={(e) => onWeekdayChange(Number(e.target.value))}
                  className={fieldClass}
                >
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={label} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Hour</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => onHourChange(Number(e.target.value))}
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Minute</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => onMinuteChange(Number(e.target.value))}
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-ink">
                Create next meetup &amp; send invites (each week)
              </h3>
              <button
                type="button"
                onClick={copyAnnounceFromKickoff}
                className="text-xs font-medium text-ink-dim hover:text-ink hover:underline"
              >
                Same as meetup time
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelClass}>Timezone (IANA)</label>
                <input
                  type="text"
                  list="tz-presets-announce"
                  value={announceTimezone}
                  onChange={(e) => onAnnounceTimezoneChange(e.target.value)}
                  placeholder="Europe/London"
                  className={fieldClass}
                />
                <datalist id="tz-presets-announce">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={labelClass}>Weekday</label>
                <select
                  value={announceWeekday}
                  onChange={(e) =>
                    onAnnounceWeekdayChange(Number(e.target.value))
                  }
                  className={fieldClass}
                >
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={label} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Hour</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={announceHour}
                    onChange={(e) => onAnnounceHourChange(Number(e.target.value))}
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Minute</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={announceMinute}
                    onChange={(e) =>
                      onAnnounceMinuteChange(Number(e.target.value))
                    }
                    className={`${fieldClass} tabular-nums`}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
