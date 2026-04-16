import { createContext } from 'react';
import type { MeResponse } from '../api/meApi';

export type AuthState = {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);
