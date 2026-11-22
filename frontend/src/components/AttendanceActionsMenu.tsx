import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Ellipsis, Hourglass, Loader2, X, XCircle } from "lucide-react";
import type { AdminAttendanceStatus } from "../api/adminApi";

export type AttendanceAction = AdminAttendanceStatus | "remove";

const ACTIONS = [
  { value: "confirmed", label: "Confirm", Icon: CheckCircle2 },
  { value: "waitlisted", label: "Waitlist", Icon: Hourglass },
  { value: "cancelled", label: "Cancel", Icon: XCircle },
  { value: "remove", label: "Remove", Icon: X },
] as const;

export function AttendanceActionsMenu({ name, status, busy, disabled, onAction }: {
  name: string;
  status: string;
  busy: boolean;
  disabled: boolean;
  onAction: (action: AttendanceAction) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const actions = ACTIONS.filter(({ value }) => value !== status);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const panel = menu.current;
    const gap = 4;
    const edge = 8;
    const above = anchor.top - gap - panel.offsetHeight;
    const below = anchor.bottom + gap;
    const bottomLimit = window.innerHeight - panel.offsetHeight - edge;
    panel.style.left = `${Math.max(edge, anchor.right - panel.offsetWidth)}px`;
    const top = below > bottomLimit && above >= edge ? above : Math.min(below, bottomLimit);
    panel.style.top = `${Math.max(edge, top)}px`;
    const items = panel.querySelectorAll("button");
    items[lastOnOpen.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node &&
          !trigger.current?.contains(event.target) &&
          !menu.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function dismissOnViewportChange(event: Event) {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      if (menu.current?.contains(document.activeElement)) {
        trigger.current?.focus({ preventScroll: true });
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", dismissOnViewportChange);
    window.addEventListener("scroll", dismissOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", dismissOnViewportChange);
      window.removeEventListener("scroll", dismissOnViewportChange, true);
    };
  }, [open]);

  function closeAndRestoreFocus() {
    trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Attendance actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return;
          lastOnOpen.current = false;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (disabled || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          lastOnOpen.current = event.key === "ArrowUp";
          if (!open) {
            setOpen(true);
          } else {
            const items = menu.current?.querySelectorAll("button");
            if (items?.length) items[lastOnOpen.current ? items.length - 1 : 0].focus();
          }
        }}
        className="grid h-11 w-11 shrink-0 place-items-center border border-line text-ink-dim hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-live aria-expanded:bg-raised aria-expanded:text-ink aria-disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Ellipsis className="h-5 w-5" aria-hidden />}
      </button>
      {open && createPortal(
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={`Attendance actions for ${name}`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) {
              setOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") event.preventDefault();
              closeAndRestoreFocus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll("button"));
            const current = items.findIndex((item) => item === document.activeElement);
            const step = event.key === "ArrowDown" ? 1 : -1;
            let next = (current + step + items.length) % items.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = items.length - 1;
            items[next]?.focus();
          }}
          className="fixed z-50 w-40 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto border border-line bg-panel p-1 shadow-lg"
        >
          {actions.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                closeAndRestoreFocus();
                onAction(value);
              }}
              className={`flex min-h-11 w-full items-center gap-2 px-3 text-sm font-medium outline-none hover:bg-raised focus-visible:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-live ${value === "remove" ? "text-danger" : "text-ink"}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
