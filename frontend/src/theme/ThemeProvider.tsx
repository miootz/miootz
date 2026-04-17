import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemeClass,
  readStoredTheme,
  resolveDark,
  writeStoredTheme,
  type ThemePreference,
} from './themeStorage';

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  resolvedDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredTheme()
  );

  const setPreference = useCallback((p: ThemePreference) => {
    writeStoredTheme(p);
    setPreferenceState(p);
    applyThemeClass(p);
  }, []);

  useEffect(() => {
    applyThemeClass(preference);
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeClass('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const resolvedDark = resolveDark(preference);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        'content',
        resolvedDark ? '#111827' : '#9333ea'
      );
    }
  }, [resolvedDark]);

  const value = useMemo(
    () => ({ preference, setPreference, resolvedDark }),
    [preference, setPreference, resolvedDark]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
