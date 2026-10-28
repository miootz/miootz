export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'miootz-theme';

export function readStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function writeStoredTheme(value: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

export function resolveDark(pref: ThemePreference): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** Apply before React paint — call from main.tsx */
export function applyThemeClass(_pref: ThemePreference): void {
  // The scoreboard world is a single dark theme; the class stays set so
  // existing dark: variants keep resolving.
  document.documentElement.classList.add("dark");
}
