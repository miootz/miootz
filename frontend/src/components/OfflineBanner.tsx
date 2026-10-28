import { useOnlineStatus } from '../offline/useOnlineStatus';

export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      className="bg-live px-4 py-2 text-center text-sm font-bold text-board"
      role="status"
    >
      You&apos;re offline — viewing cached data when available.
    </div>
  );
}
