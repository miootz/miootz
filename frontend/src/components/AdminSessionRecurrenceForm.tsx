import {
  COMMON_TIMEZONES,
  inferRecurrenceWallTime,
  WEEKDAY_LABELS,
} from '../utils/recurrence';

type Props = {
  startLocal: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** e.g. "Schedule active" on template pages vs "Repeat weekly" on sessions */
  scheduleToggleLabel?: string;
  /** Hide "Match start time above" (no session start field on template admin). */
  hideMatchStartButton?: boolean;
  /** Replaces the note under meetup time (session vs template copy). */
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
  /** When each week to create the next session + send join-link pushes */
  announceTimezone: string;
  onAnnounceTimezoneChange: (v: string) => void;
  announceWeekday: number;
  onAnnounceWeekdayChange: (v: number) => void;
  announceHour: number;
  onAnnounceHourChange: (v: number) => void;
  announceMinute: number;
  onAnnounceMinuteChange: (v: number) => void;
  showDisabledHint?: boolean;
};

export function AdminSessionRecurrenceForm({
  startLocal,
  enabled,
  onEnabledChange,
  scheduleToggleLabel = 'Repeat weekly',
  hideMatchStartButton = false,
  kickoffHelperText = 'Must match the session start time field.',
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
  showDisabledHint = true,
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
    <div className="rounded-xl border border-violet-200 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/20 p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {scheduleToggleLabel}
          </span>
        </label>
      </div>

      {showDisabledHint && !enabled ? (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          The first session sets location, fees, and roster size. When repeat is on,
          you define the weekly kickoff time and a separate weekly moment when the
          next meetup is created and invite notifications (with join links) are sent.
        </p>
      ) : null}

      {enabled ? (
        <>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Meetup time (each week)
              </h3>
              {!hideMatchStartButton ? (
                <button
                  type="button"
                  onClick={syncKickoffFromStart}
                  className="text-xs font-medium text-violet-700 dark:text-violet-300 hover:underline"
                >
                  Match start time above
                </button>
              ) : null}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              {kickoffHelperText}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Timezone (IANA)
                </label>
                <input
                  type="text"
                  list="tz-presets-kickoff"
                  value={timezone}
                  onChange={(e) => onTimezoneChange(e.target.value)}
                  placeholder="Europe/London"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                />
                <datalist id="tz-presets-kickoff">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Weekday
                </label>
                <select
                  value={weekday}
                  onChange={(e) => onWeekdayChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Hour
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => onHourChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Minute
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => onMinuteChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-violet-200/80 dark:border-violet-900/50 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Create next session & send invites (each week)
              </h3>
              <button
                type="button"
                onClick={copyAnnounceFromKickoff}
                className="text-xs font-medium text-violet-700 dark:text-violet-300 hover:underline"
              >
                Same as meetup time
              </button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              At this clock time each week, the server adds the next meetup (if not
              already there) and sends browser notifications to subscribed members.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Timezone (IANA)
                </label>
                <input
                  type="text"
                  list="tz-presets-announce"
                  value={announceTimezone}
                  onChange={(e) => onAnnounceTimezoneChange(e.target.value)}
                  placeholder="Europe/London"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
                />
                <datalist id="tz-presets-announce">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Weekday
                </label>
                <select
                  value={announceWeekday}
                  onChange={(e) =>
                    onAnnounceWeekdayChange(Number(e.target.value))
                  }
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Hour
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={announceHour}
                    onChange={(e) => onAnnounceHourChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Minute
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={announceMinute}
                    onChange={(e) =>
                      onAnnounceMinuteChange(Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
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
