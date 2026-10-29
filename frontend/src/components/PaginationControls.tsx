import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationControlsProps = {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
};

export function PaginationControls({
  page,
  total,
  pageSize,
  onPage,
}: PaginationControlsProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const btn =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center border border-line bg-panel text-ink-dim hover:bg-raised hover:text-ink disabled:opacity-50 active:scale-[0.98] transition-colors";

  return (
    <nav
      className="flex items-center justify-between gap-3"
      aria-label="Pagination"
    >
      <button
        type="button"
        className={btn}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim tabular-nums">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className={btn}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
