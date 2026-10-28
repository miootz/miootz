import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Info, X, XCircle } from 'lucide-react';

export type ToastVariant = 'default' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<
  ToastVariant,
  string
> = {
  default: 'bg-panel border border-line text-ink',
  success: 'bg-panel border border-team-a/40 text-ink',
  error: 'bg-panel border border-danger/40 text-ink',
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  if (variant === 'success')
    return <Check className="mt-0.5 h-4 w-4 shrink-0 text-team-a" aria-hidden />;
  if (variant === 'error')
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />;
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-dim" aria-hidden />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'default') => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const handle = setTimeout(() => dismiss(id), 4000);
      timers.current.set(id, handle);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-4 sm:items-end sm:p-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md min-w-[min(100%,20rem)] items-start gap-3 px-4 py-3 text-sm shadow-lg motion-safe:animate-[toastIn_0.2s_ease-out] motion-reduce:animate-none ${VARIANT_STYLES[t.variant]}`}
            role="status"
          >
            <VariantIcon variant={t.variant} />
            <p className="flex-1 text-left">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 p-1 text-ink-dim hover:text-ink focus:outline-hidden focus:ring-2 focus:ring-live"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
