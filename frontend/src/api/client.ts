import { useContext } from "react";
import { AuthContext } from "../auth/auth-context";
import { authorize } from "../auth/pocketIdOidc";

/** Base path for API (same-origin /api in production / Traefik). */
export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) || "/api";
}

/** Clear persisted OIDC tokens after a hard 401 (session no longer valid). */
function clearStoredTokens(): void {
  try {
    localStorage.removeItem("miootz_tokens");
    localStorage.removeItem("miootz_id_token");
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
  window.setTimeout(() => {
    _authRedirectInFlight = false;
  }, 3000);
  try {
    sessionStorage.setItem(
      "miootz_return_path",
      window.location.pathname + window.location.search,
    );
  } catch {
    /* ignore */
  }
  void authorize();
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
 * Fetch with auto Bearer token from AuthContext.
 * Pass `skipAuth` to skip token injection (public endpoints).
 */
export function useApiFetch() {
  const auth = useContext(AuthContext);

  return async (
    path: string,
    init?: RequestInit & { skipAuth?: boolean },
  ): Promise<Response> => {
    const skipAuth = init?.skipAuth;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (!skipAuth && auth?.tokens?.accessToken) {
      headers.Authorization = `Bearer ${auth.tokens.accessToken}`;
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

    if (response.status === 401 && auth?.login) {
      // Token rejected server-side: drop stale tokens and re-auth once.
      clearStoredTokens();
      redirectToLogin();
    }

    return response;
  };
}

/**
 * Legacy: plain fetch without auth context.
 * Use `useApiFetch()` hook for authenticated requests.
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
      const raw = localStorage.getItem("miootz_tokens");
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

  if (response.status === 401) {
    clearStoredTokens();
    redirectToLogin();
  }

  return response;
}
