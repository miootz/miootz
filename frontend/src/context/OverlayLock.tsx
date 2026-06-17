import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/**
 * Ensures only one full-screen overlay (install prompt, notification prompt)
 * is visible at a time. The first to acquire the lock shows; others wait.
 */
interface OverlayLockContextValue {
  /** Request the overlay lock. Returns true if acquired, false if another overlay is active. */
  tryAcquire: (id: string) => boolean;
  /** Release the overlay lock. */
  release: (id: string) => void;
  /** Check if any overlay is currently locked. */
  isLocked: boolean;
  /** The id of the currently active overlay, or null. */
  activeId: string | null;
}

const OverlayLockContext = createContext<OverlayLockContextValue>({
  tryAcquire: () => false,
  release: () => {},
  isLocked: false,
  activeId: null,
});

export function OverlayLockProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const tryAcquire = useCallback((id: string) => {
    if (activeId !== null && activeId !== id) return false;
    setActiveId(id);
    return true;
  }, [activeId]);

  const release = useCallback((id: string) => {
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  return (
    <OverlayLockContext.Provider
      value={{
        tryAcquire,
        release,
        isLocked: activeId !== null,
        activeId,
      }}
    >
      {children}
    </OverlayLockContext.Provider>
  );
}

export function useOverlayLock(): OverlayLockContextValue {
  return useContext(OverlayLockContext);
}
