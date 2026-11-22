import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAppStore } from "@/store/useAppStore";
import AppShell from "./AppShell";
import BrandHeader from "./BrandHeader";
import TabBar from "./TabBar";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import PlanUpsell from "@/components/plan/PlanUpsell";

const WITHOUT_PRIMARY = [
  "/addresses",
  "/onboarding/distributor",
  "/subscription",
  "/pay",
  "/card-payment",
  "/payment-failed",
  "/profile",
  "/support",
];

function allowsWithoutPrimary(pathname: string) {
  return WITHOUT_PRIMARY.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default function ProtectedLayout({ tabs = false }: { tabs?: boolean }) {
  const session = useAppStore((s) => s.session);
  const hydrated = useAppStore((s) => s.hydrated);
  const primaryDistributorId = useAppStore((s) => s.primaryDistributorId);
  const addresses = useAppStore((s) => s.addresses);
  const location = useLocation();

  if (!hydrated) {
    return (
      <AppShell>
        <BrandedWaitScreen />
      </AppShell>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!primaryDistributorId && !allowsWithoutPrimary(location.pathname)) {
    if (addresses.length === 0) {
      return <Navigate to="/addresses" replace />;
    }
    return <Navigate to="/onboarding/distributor" replace />;
  }
  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {tabs && location.pathname === "/" ? <BrandHeader /> : null}
        <Outlet />
        <PlanUpsell />
      </div>
      {tabs ? <TabBar /> : null}
    </AppShell>
  );
}
