import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Mobile-native bottom sheet on the native <dialog>: focus containment,
 * top-layer rendering, Escape/back-gesture dismissal and outside-tap close.
 * Bottom-anchored and full-width on phones (safe-area-aware), centered on sm+.
 * The caller renders it conditionally ({open && <MobileSheet ... />}).
 */
export function MobileSheet({
  onClose,
  title,
  headerExtra,
  footer,
  children,
  maxWidth = "max-w-md",
  bodyClassName,
}: {
  onClose: () => void;
  title: string;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
  bodyClassName?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const isOutside = (event: PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => { pressedOutside.current = isOutside(event); }}
      onPointerUp={(event) => {
        if (pressedOutside.current && isOutside(event)) close();
      }}
      className={`fixed inset-x-0 top-auto bottom-0 mx-auto flex max-h-[100dvh] w-full flex-col overflow-hidden border-t border-line bg-panel text-ink shadow-xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:border ${maxWidth}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-4 pb-3">
        <h2 id={titleId} className="shrink-0 text-lg font-bold text-ink">{title}</h2>
        {headerExtra}
        <button
          type="button"
          onClick={close}
          className="grid h-11 w-11 shrink-0 place-items-center text-ink-dim hover:bg-raised hover:text-ink"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className={`min-h-0 flex-1 ${bodyClassName ?? "overflow-y-auto overscroll-y-contain px-4 py-4"}`}>
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
