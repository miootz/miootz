import { useId, useLayoutEffect, useRef, useState } from "react";

export function RemoveAttendanceDialog({ name, onConfirm, onCancel }: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [final, setFinal] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useLayoutEffect(() => {
    cancelRef.current?.focus();
  }, [final]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      className="fixed inset-x-0 top-auto bottom-4 mx-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto overscroll-contain border border-line bg-panel p-6 text-ink shadow-xl backdrop:bg-black/50 sm:inset-0 sm:m-auto"
    >
      <h2 id={titleId} aria-live="polite" className="break-words text-lg font-bold text-ink">
        {final ? `Permanently remove ${name}?` : `Remove ${name}?`}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm text-ink-dim">
        This permanently deletes this player's meetup statistics, including goals and ratings, and assists on their goals. Adding them again will not restore this data. Recorded match results stay the same.
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} className="min-h-11 border border-line px-4 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink">
          Cancel
        </button>
        <button type="button" onClick={() => final ? onConfirm() : setFinal(true)} className="min-h-11 border border-danger/40 px-4 py-2.5 text-sm font-bold text-danger hover:bg-danger/10">
          {final ? "Permanently remove" : "Continue"}
        </button>
      </div>
    </dialog>
  );
}
