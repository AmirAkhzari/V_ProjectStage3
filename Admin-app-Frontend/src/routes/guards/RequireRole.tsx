import { Outlet } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import type { Permission } from "@/types";
import { useCan } from "@/store/useSessionStore";
import EmptyState from "@/components/shared/EmptyState";

export default function RequireRole({ perm }: { perm: Permission | Permission[] }) {
  const allowed = useCan(perm);
  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldOff />}
        title="دسترسی غیرمجاز"
        description="نقش شما اجازه مشاهده این بخش را ندارد."
        className="py-32"
      />
    );
  }
  return <Outlet />;
}
