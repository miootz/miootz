import { createContext } from 'react';
import type { MeResponse } from '../api/meApi';
import type { OidcTokens } from './pocketIdOidc';

export type AuthState = {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  tokens: OidcTokens | null;
  refresh: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);
