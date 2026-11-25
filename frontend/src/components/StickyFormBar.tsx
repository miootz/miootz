import type { ReactNode } from "react";

/**
 * Pinned bottom bar for long forms — the primary action lives in the thumb
 * zone above the safe area while the page content scrolls under it.
 * The page's content needs enough bottom padding to clear the bar.
 */
export function StickyFormBar({
  children,
  innerClassName = "max-w-xl",
}: {
  children: ReactNode;
  /** Inner container width — match the page's content width. */
  innerClassName?: string;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-board px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className={`mx-auto ${innerClassName}`}>{children}</div>
    </div>
  );
}
