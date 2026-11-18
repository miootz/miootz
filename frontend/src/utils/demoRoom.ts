/** Demo rooms share an origin, but must not share browser data. */
export function demoRoom(): string {
  if (import.meta.env.VITE_DEMO !== '1') return '';
  return window.location.pathname.match(/^\/(?:squad|matchday)(?=\/|$)/)?.[0] ?? '';
}

export function shouldOpenDemoLobby(): boolean {
  return import.meta.env.VITE_DEMO === '1' && import.meta.env.VITE_DEMO_ROOMS === '1' && !demoRoom();
}

export function roomPath(path: string): string {
  const room = demoRoom();
  return room && path !== room && !path.startsWith(`${room}/`) ? `${room}${path}` : path;
}

export function roomStorageKey(key: string): string {
  const room = demoRoom();
  return room ? `${key}:${room}` : key;
}
