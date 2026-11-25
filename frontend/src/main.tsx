import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import { ToastProvider } from './context/ToastContext';
import { UpdateChecker } from './components/UpdateChecker';
import { DemoModeBar } from './components/DemoModeBar';
import { applyThemeClass, readStoredTheme } from './theme/themeStorage';
import { processOutbox } from './offline/outbox';
import { demoRoom, shouldOpenDemoLobby } from './utils/demoRoom';

if (shouldOpenDemoLobby()) {
  window.location.replace('/api/demo');
} else {
  applyThemeClass(readStoredTheme());

  window.addEventListener('online', () => {
    void processOutbox();
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="flex h-[100dvh] flex-col">
        <DemoModeBar />
        <BrowserRouter basename={demoRoom() || undefined}>
          <ThemeProvider>
            <ToastProvider>
              <UpdateChecker />
              <AuthProvider>
                <App />
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </BrowserRouter>
      </div>
    </StrictMode>
  );

  // Service workers require a trusted certificate; skip on Vite dev (e.g. Traefik + self-signed :8443).
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const room = demoRoom();
    if (room) {
      // Retire the old root-scoped demo worker, which predates room isolation.
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.filter((r) => new URL(r.scope).pathname === '/').map((r) => r.unregister())),
      ).catch(() => {});
    }
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${room}/sw.js`, { updateViaCache: 'none' }).catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}
