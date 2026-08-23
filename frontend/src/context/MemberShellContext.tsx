import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface MemberHeaderInfo {
  line1: string;
  line2?: string;
  location?: string;
  fee?: number;
  sessionId?: number;
  sseLive?: boolean;
}

interface MemberShellContextValue {
  header: MemberHeaderInfo | null;
  setHeader: (info: MemberHeaderInfo | null) => void;
}

const MemberShellContext = createContext<MemberShellContextValue | null>(null);

export function MemberShellProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<MemberHeaderInfo | null>(null);

  const setHeader = useCallback((info: MemberHeaderInfo | null) => {
    setHeaderState(info);
  }, []);

  const value = useMemo(
    () => ({
      header,
      setHeader,
    }),
    [header, setHeader]
  );

  return (
    <MemberShellContext.Provider value={value}>
      {children}
    </MemberShellContext.Provider>
  );
}

export function useMemberShell(): MemberShellContextValue {
  const ctx = useContext(MemberShellContext);
  if (!ctx) {
    throw new Error('useMemberShell must be used within MemberShellProvider');
  }
  return ctx;
}
