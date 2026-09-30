import { Badge } from "@/components/ui/badge";
import type { RetailerPlan, SubscriptionStatus } from "@/types";

export function PlanBadge({ plan }: { plan: RetailerPlan }) {
  return plan === "pro" ? <Badge variant="solid">پرو</Badge> : <Badge variant="muted">رایگان</Badge>;
}

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const map: Record<SubscriptionStatus, { label: string; variant: "neutral" | "muted" | "danger" }> = {
    active: { label: "فعال", variant: "neutral" },
    expired: { label: "منقضی", variant: "muted" },
    cancelled: { label: "لغو شده", variant: "danger" },
  };
  return <Badge variant={map[status].variant}>{map[status].label}</Badge>;
}
