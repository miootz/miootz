import { useLayoutEffect, useRef } from "react";
import { IS_IOS, hapticsEnabled, hapticToggle } from "../utils/haptics";

/**
 * Native-like toggle switch with haptic feedback. On iOS Safari the tap
 * lands on an invisible native <input switch> (WebKit plays the system
 * tick; click still bubbles to the button); Android/desktop get a short
 * vibration. Reduced-motion users get neither.
 */
export function ToggleSwitch({
  enabled,
  disabled,
  onChange,
  ariaLabel,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const btn = btnRef.current;
    if (!btn) return;
    if (!IS_IOS || !hapticsEnabled()) return;
    if (btn.disabled || btn.querySelector("input[data-tap-tick]")) return;
    if (getComputedStyle(btn).position === "static") btn.style.position = "relative";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.setAttribute("switch", "");
    inp.dataset.tapTick = "1";
    inp.tabIndex = -1;
    inp.setAttribute("aria-hidden", "true");
    Object.assign(inp.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      opacity: "0",
      margin: "0",
      padding: "0",
      border: "0",
      appearance: "none",
      cursor: "inherit",
    });
    // Reset outside the gesture so the re-check doesn't fire a second tick.
    inp.addEventListener("change", () => {
      requestAnimationFrame(() => {
        inp.checked = false;
      });
    });
    btn.appendChild(inp);
  });

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={disabled}
      onClick={() => {
        hapticToggle();
        onChange();
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-hidden focus:ring-2 focus:ring-live ${
        enabled ? "bg-live" : "bg-raised"
      } disabled:opacity-50`}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform bg-ink transition ${
          enabled ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
