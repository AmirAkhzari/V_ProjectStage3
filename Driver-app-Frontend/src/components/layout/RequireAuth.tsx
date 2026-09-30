import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";
import AppShell from "./AppShell";

export default function RequireAuth() {
  const session = useSessionStore((s) => s.session);
  const hydrated = useSessionStore((s) => s.hydrated);
  const location = useLocation();
  if (!hydrated) return null;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function RedirectIfAuthed() {
  const session = useSessionStore((s) => s.session);
  const hydrated = useSessionStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (session) return <Navigate to="/" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
