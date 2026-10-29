import { useEffect, useId } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, confirm button uses destructive styling */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Dismiss"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md border border-line bg-panel p-6 shadow-xl"
      >
        <h2
          id={titleId}
          className="text-lg font-bold text-ink"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm text-ink-dim">
            {description}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center border border-line px-4 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex items-center justify-center px-4 py-2.5 text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-live ${
              destructive
                ? 'border border-danger/40 text-danger hover:bg-danger/10'
                : 'bg-ink text-board hover:bg-white/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
