import { apiFetch } from '../api/client';

export function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/** Subscribe this browser to Web Push (requires HTTPS or localhost, and server VAPID keys). */
export async function subscribeToWebPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) {
    return { ok: false, reason: 'Not supported in this browser' };
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, reason: 'Notification permission denied' };
  }
  const r = await apiFetch('/users/me/push/config');
  if (!r.ok) {
    return { ok: false, reason: 'Could not load push config' };
  }
  const { publicKey } = (await r.json()) as { publicKey: string | null };
  if (!publicKey) {
    return { ok: false, reason: 'Server has not configured Web Push' };
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
    return { ok: false, reason: 'Invalid subscription' };
  }
  const save = await apiFetch('/users/me/push/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: j.endpoint,
      keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
    }),
  });
  if (!save.ok) {
    return { ok: false, reason: 'Could not save subscription on server' };
  }
  return { ok: true };
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  created_at: string;
}

export async function unsubscribeFromWebPush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  await apiFetch('/users/me/push/subscription', { method: 'DELETE' });
}

export async function fetchPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  const r = await apiFetch('/users/me/push/subscriptions');
  if (!r.ok) throw new Error('Could not fetch push subscriptions');
  const data = (await r.json()) as { items: PushSubscriptionRow[] };
  return data.items;
}

export async function deletePushSubscription(id: number): Promise<void> {
  const r = await apiFetch(`/users/me/push/subscriptions/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Could not remove device');
}
