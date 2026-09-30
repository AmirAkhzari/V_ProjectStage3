import { Navigate, Outlet } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import { useAppStore } from "@/store/useAppStore";

export default function GuestLayout() {
  const session = useAppStore((s) => s.session);
  const hydrated = useAppStore((s) => s.hydrated);
  if (!hydrated) {
    return (
      <AppShell>
        <BrandedWaitScreen />
      </AppShell>
    );
  }
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}
