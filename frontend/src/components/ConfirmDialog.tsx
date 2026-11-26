import { MobileSheet } from './MobileSheet';

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
  if (!open) return null;

  return (
    <MobileSheet
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 border border-line px-4 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-12 flex-1 px-4 py-2.5 text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-live ${
              destructive
                ? 'border border-danger/40 text-danger hover:bg-danger/10'
                : 'bg-ink text-board hover:bg-white/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      {description ? (
        <p className="text-sm text-ink-dim">{description}</p>
      ) : null}
    </MobileSheet>
  );
}
