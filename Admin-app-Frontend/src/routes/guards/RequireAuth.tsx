import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSessionStore } from "@/store/useSessionStore";
import { paths } from "@/routes/paths";

export default function RequireAuth() {
  const session = useSessionStore((s) => s.session);
  const hydrated = useSessionStore((s) => s.hydrated);
  const location = useLocation();

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center text-label-secondary">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  if (!session) return <Navigate to={paths.login} replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const session = useSessionStore((s) => s.session);
  const hydrated = useSessionStore((s) => s.hydrated);
  if (hydrated && session) return <Navigate to={paths.dashboard} replace />;
  return <Outlet />;
}
