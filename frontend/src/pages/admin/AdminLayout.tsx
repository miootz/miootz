import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Calendar,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  Repeat,
  UserCircle,
  Wrench,
  X,
  ScrollText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { logout } from "../../auth/pocketIdOidc";
import { useAuth } from "../../auth/useAuth";
import { setPreferMemberView } from "../../auth/memberViewStorage";
import { OfflineBanner } from "../../components/OfflineBanner";
import { AdminNotificationPrompt } from "../../components/admin/AdminNotificationPrompt";

const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
    isActive
      ? "bg-ink text-board font-bold"
      : "text-ink-dim hover:bg-raised hover:text-ink"
  }`;

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <NavLink to="/admin" end className={navCls} onClick={onNavigate}>
        <LayoutDashboard className="w-4 h-4 shrink-0" />
        Overview
      </NavLink>
      <NavLink to="/admin/meetups" className={navCls} onClick={onNavigate}>
        <Calendar className="w-4 h-4 shrink-0" />
        Meetups
      </NavLink>
      <NavLink
        to="/admin/game-templates"
        className={navCls}
        onClick={onNavigate}
      >
        <Repeat className="w-4 h-4 shrink-0" />
        Templates
      </NavLink>
      <NavLink to="/admin/players" className={navCls} onClick={onNavigate}>
        <Users className="w-4 h-4 shrink-0" />
        Players
      </NavLink>
      <NavLink to="/admin/tools" className={navCls} onClick={onNavigate}>
        <Wrench className="w-4 h-4 shrink-0" />
        Tools
      </NavLink>
      <NavLink to="/admin/audit" className={navCls} onClick={onNavigate}>
        <ScrollText className="w-4 h-4 shrink-0" />
        Audit
      </NavLink>
      <NavLink to="/profile" className={navCls} onClick={onNavigate}>
        <UserCircle className="w-4 h-4 shrink-0" />
        Profile
      </NavLink>
    </>
  );
}

export function AdminLayout() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** Pathname when the mobile drawer was opened; drawer stays open only while it matches. */
  const [navPathWhenOpened, setNavPathWhenOpened] = useState<string | null>(
    null,
  );
  const drawerOpen =
    mobileNavOpen &&
    navPathWhenOpened != null &&
    navPathWhenOpened === location.pathname;

  const openDrawer = () => {
    setNavPathWhenOpened(location.pathname);
    setMobileNavOpen(true);
  };
  const closeDrawer = () => {
    setMobileNavOpen(false);
    setNavPathWhenOpened(null);
  };

  useEffect(() => {
    if (!loading && me && !me.is_admin) {
      navigate("/", { replace: true });
    }
  }, [loading, me, navigate]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!me?.is_admin) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (e.key === "Escape" && drawerOpen) {
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (inField) return;
      if (e.key === "n" || e.key === "N") {
        if (location.pathname === "/admin/meetups") {
          e.preventDefault();
          navigate("/admin/meetups/new");
        }
      } else if (e.key === "/") {
        e.preventDefault();
        document.getElementById("admin-meetups-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me?.is_admin, location.pathname, navigate, drawerOpen]);

  if (loading || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-board">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-2 border-line border-t-live animate-spin"
            aria-hidden
          />
          <p className="text-sm text-ink-dim">Loading…</p>
        </div>
      </div>
    );
  }

  if (!me.is_admin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-board flex flex-col md:flex-row">
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[120] focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-board focus:outline-hidden focus:ring-2 focus:ring-live"
      >
        Skip to main content
      </a>
      <OfflineBanner />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-board/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={openDrawer}
          className="inline-flex h-11 w-11 items-center justify-center border border-line bg-panel text-ink hover:bg-raised focus:outline-hidden focus:ring-2 focus:ring-live"
          aria-expanded={drawerOpen}
          aria-label="Open admin menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
            Admin
          </p>
          <p className="truncate text-sm font-medium text-ink">
            {me.user.display_name}
          </p>
        </div>
        <div className="w-10" aria-hidden />
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 border-b md:border-b-0 md:border-r border-line bg-panel md:min-h-screen shrink-0 flex-col">
        <div className="p-4 border-b border-line">
          <Link
            to="/"
            onClick={() => setPreferMemberView(true)}
            className="inline-flex items-center gap-2 border border-line bg-raised/50 px-3 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink transition-colors w-full"
          >
            <Home className="w-4 h-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="text-left">
              <span className="block">Member view</span>
              <span className="block text-xs font-normal text-ink-faint">
                Player home & meetups
              </span>
            </span>
          </Link>
          <h2 className="mt-4 text-2xs font-bold uppercase tracking-[0.14em] text-ink">
            Admin
          </h2>
          <p
            className="text-xs text-ink-dim truncate mt-1"
            title={me.user.display_name ?? ""}
          >
            {me.user.display_name}
          </p>
        </div>
        <nav className="p-2 flex flex-col gap-1 flex-1">
          <AdminNavLinks />
        </nav>
        <div className="p-4 mt-auto border-t border-line space-y-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs text-ink-faint hover:text-ink"
          >
            Refresh session
          </button>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="flex items-center gap-1.5 text-xs text-danger hover:opacity-80"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={closeDrawer}
          />
          <div
            className="absolute left-0 top-0 flex h-full w-[min(20rem,88vw)] flex-col border-r border-line bg-panel shadow-xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <div className="flex items-center justify-between border-b border-line p-4">
              <div>
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink">
                  Admin
                </p>
                <p className="truncate text-sm font-medium text-ink">
                  {me.user.display_name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="inline-flex h-11 w-11 items-center justify-center border border-line text-ink-dim hover:bg-raised hover:text-ink"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="border-b border-line p-4">
              <Link
                to="/"
                onClick={() => {
                  setPreferMemberView(true);
                  closeDrawer();
                }}
                className="inline-flex items-center gap-2 border border-line bg-raised/50 px-3 py-2.5 text-sm font-medium text-ink-dim hover:bg-raised hover:text-ink w-full"
              >
                <Home
                  className="w-4 h-4 shrink-0 text-ink-faint"
                  aria-hidden
                />
                Member view
              </Link>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
              <AdminNavLinks onNavigate={closeDrawer} />
            </nav>
            <div className="border-t border-line p-4">
              <button
                type="button"
                onClick={() => void refresh()}
                className="text-xs text-ink-faint hover:text-ink"
              >
                Refresh session
              </button>
            </div>
          </div>
        </div>
      )}

      <main
        id="admin-main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 outline-hidden"
        style={{
          paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <AdminNotificationPrompt />
        <Outlet />
      </main>
    </div>
  );
}
