import { useLayoutEffect, useRef } from "react";
import { hapticToggle } from "../utils/haptics";

/** A native checkbox with switch semantics and a larger touch target. */
export function ToggleSwitch({
  enabled,
  disabled,
  onChange,
  ariaLabel,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    // Safari supports the native switch attribute, including its haptic tick.
    inputRef.current?.setAttribute("switch", "");
  }, []);

  return (
    <span className="relative inline-flex h-6 w-11 shrink-0">
      <input
        ref={inputRef}
        type="checkbox"
        role="switch"
        checked={enabled}
        aria-checked={enabled}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={() => { if (!disabled) { hapticToggle(); onChange(); } }}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span aria-hidden className={`pointer-events-none inline-flex h-6 w-11 border-2 border-transparent transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-live peer-disabled:opacity-50 ${enabled ? "bg-live" : "bg-raised"}`}>
        <span className={`inline-block h-5 w-5 bg-ink transition-transform ${enabled ? "translate-x-5" : "translate-x-1"}`} />
      </span>
    </span>
  );
}
