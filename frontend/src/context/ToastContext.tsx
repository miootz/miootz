import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';

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
  default:
    'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border border-gray-700 dark:border-gray-300',
  success:
    'bg-emerald-800 dark:bg-emerald-900/95 text-emerald-50 border border-emerald-600/50',
  error: 'bg-red-800 dark:bg-red-900/95 text-red-50 border border-red-600/50',
};

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
            className={`pointer-events-auto flex max-w-md min-w-[min(100%,20rem)] items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg motion-safe:animate-[toastIn_0.2s_ease-out] motion-reduce:animate-none ${VARIANT_STYLES[t.variant]}`}
            role="status"
          >
            <p className="flex-1 text-left">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-1 opacity-80 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
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
