import { createContext } from 'react';
import type { MeResponse, Specialty } from '../api/meApi';
import type { OidcTokens } from './pocketIdOidc';

export type AuthState = {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  tokens: OidcTokens | null;
  refresh: () => Promise<void>;
  savePosition: (field: 'primary_specialty' | 'secondary_specialty', value: Specialty | null) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);
