import { useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../auth/auth-context";

export function PlayerEditLink({ playerId, children, className = "", stretch = false }: {
  playerId: number | string;
  children: ReactNode;
  className?: string;
  stretch?: boolean;
}) {
  const auth = useContext(AuthContext);
  if (!auth?.me?.is_admin || !/^[1-9]\d*$/.test(String(playerId))) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      to={`/admin/players/${playerId}`}
      draggable={false}
      className={`${className} hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-live ${stretch ? "after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-live" : ""}`}
    >
      {children}
    </Link>
  );
}
