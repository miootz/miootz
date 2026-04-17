import { useOnlineStatus } from '../offline/useOnlineStatus';

export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
      role="status"
    >
      You&apos;re offline — viewing cached data when available.
    </div>
  );
}
