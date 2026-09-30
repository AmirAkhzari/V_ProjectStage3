import type { ReactNode } from "react";
import type { Permission } from "@/types";
import { useCan } from "@/store/useSessionStore";

export default function Can({
  perm,
  children,
  fallback = null,
}: {
  perm: Permission | Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useCan(perm);
  return <>{allowed ? children : fallback}</>;
}
