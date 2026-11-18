import { afterEach, expect, it, vi } from 'vitest';

const { createRoot } = vi.hoisted(() => ({ createRoot: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('react-router-dom', () => ({ BrowserRouter: () => null }));
vi.mock('./App.tsx', () => ({ default: () => null }));
vi.mock('./auth/AuthProvider', () => ({ AuthProvider: () => null }));
vi.mock('./theme/ThemeProvider', () => ({ ThemeProvider: () => null }));
vi.mock('./context/ToastContext', () => ({ ToastProvider: () => null }));
vi.mock('./components/UpdateChecker', () => ({ UpdateChecker: () => null }));
vi.mock('./components/DemoModeBar', () => ({ DemoModeBar: () => null }));
vi.mock('./theme/themeStorage', () => ({ applyThemeClass: vi.fn(), readStoredTheme: vi.fn() }));
vi.mock('./offline/outbox', () => ({ processOutbox: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('opens the hosted lobby before creating the app or registering a worker', async () => {
  vi.stubEnv('VITE_DEMO', '1');
  vi.stubEnv('VITE_DEMO_ROOMS', '1');
  vi.stubEnv('PROD', true);
  const replace = vi.fn();
  const register = vi.fn();
  const getRegistrations = vi.fn();
  vi.stubGlobal('window', { location: { pathname: '/', replace }, addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { serviceWorker: { register, getRegistrations } });

  await import('./main');

  expect(replace).toHaveBeenCalledWith('/api/demo');
  expect(createRoot).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(getRegistrations).not.toHaveBeenCalled();
});
