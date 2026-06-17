import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type MemberView = 'details' | 'history';

export interface MemberHeaderInfo {
  line1: string;
  line2?: string;
  location?: string;
  fee?: number;
  sessionId?: number;
  sseLive?: boolean;
}

interface MemberShellContextValue {
  memberView: MemberView;
  setMemberView: (v: MemberView) => void;
  header: MemberHeaderInfo | null;
  setHeader: (info: MemberHeaderInfo | null) => void;
}

const MemberShellContext = createContext<MemberShellContextValue | null>(null);

export function MemberShellProvider({ children }: { children: ReactNode }) {
  const [memberView, setMemberViewState] = useState<MemberView>('details');
  const [header, setHeaderState] = useState<MemberHeaderInfo | null>(null);

  const setMemberView = useCallback((v: MemberView) => {
    setMemberViewState(v);
  }, []);

  const setHeader = useCallback((info: MemberHeaderInfo | null) => {
    setHeaderState(info);
  }, []);

  const value = useMemo(
    () => ({
      memberView,
      setMemberView,
      header,
      setHeader,
    }),
    [memberView, setMemberView, header, setHeader]
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
