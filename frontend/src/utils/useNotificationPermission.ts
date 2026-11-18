import { useEffect, useState } from "react";

function currentPermission(): NotificationPermission | null {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : null;
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState(currentPermission);

  useEffect(() => {
    const sync = () => setPermission(currentPermission());
    let status: PermissionStatus | undefined;
    let cancelled = false;

    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: "notifications" }).then((result) => {
        if (cancelled) return;
        status = result;
        status.addEventListener("change", sync);
        sync();
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      status?.removeEventListener("change", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return [permission, setPermission] as const;
}
