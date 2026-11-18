import { authorize } from "../auth/pocketIdOidc";
import { demoRoom, roomPath, roomStorageKey } from "../utils/demoRoom";

/** Base path for API (same-origin /api in production / Traefik). */
export function apiBase(): string {
  return demoRoom() ? roomPath("/api") : (import.meta.env.VITE_API_BASE as string | undefined) || "/api";
}

/** Clear persisted OIDC tokens after a hard 401 (meetup no longer valid). */
function clearStoredTokens(): void {
  try {
    localStorage.removeItem(roomStorageKey("miootz_tokens"));
    localStorage.removeItem(roomStorageKey("miootz_id_token"));
  } catch {
    /* ignore */
  }
}

// A burst of 401s (parallel requests with an expired token) must trigger a
// single OIDC redirect — concurrent authorize() calls would race on PKCE
// state. The flag self-resets so a failed authorize doesn't lock us out.
let _authRedirectInFlight = false;

function redirectToLogin(): void {
  if (_authRedirectInFlight) return;
  _authRedirectInFlight = true;
  try {
    sessionStorage.setItem(
      roomStorageKey("miootz_return_path"),
      window.location.pathname + window.location.search,
    );
  } catch {
    /* ignore */
  }
  if (import.meta.env.VITE_DEMO === '1') {
    window.location.replace(roomPath('/api/demo'));
    return;
  }
  // authorize() resolves once the redirect is issued (or rejects on failure)
  // — the flag resets on the real outcome, not a guessed timeout.
  void authorize().finally(() => {
    _authRedirectInFlight = false;
  });
}

export async function parseApiError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((x) =>
          typeof x === "object" && x !== null && "msg" in x
            ? String((x as { msg: string }).msg)
            : String(x),
        )
        .join(", ");
    }
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

/**
 * Fetch with auto Bearer token from localStorage.
 * Pass `skipAuth` to skip token injection (public endpoints).
 */
export async function apiFetch(
  path: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<Response> {
  const skipAuth = init?.skipAuth;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // Try to get token from local storage (fallback for non-hook usage)
  if (!skipAuth) {
    try {
      const raw = localStorage.getItem(roomStorageKey("miootz_tokens"));
      if (raw) {
        const t = JSON.parse(raw) as { accessToken: string };
        if (t.accessToken) {
          headers.Authorization = `Bearer ${t.accessToken}`;
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (init?.body && typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const url = path.startsWith("http")
    ? path
    : `${apiBase()}${path.startsWith("/") ? "" : "/"}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...init?.headers,
    },
  });

  // Public endpoints (skipAuth) can 401 without a meetup — clearing tokens
  // and bouncing to login would trap an otherwise-valid meetup.
  if (response.status === 401 && !skipAuth) {
    clearStoredTokens();
    redirectToLogin();
  }

  return response;
}
