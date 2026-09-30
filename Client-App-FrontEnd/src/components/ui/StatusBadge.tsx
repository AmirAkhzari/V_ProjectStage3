import { cn } from "@/lib/cn";
import type { OrderStatus } from "@/types";

const MAP: Record<OrderStatus, { label: string; className: string }> = {
  current: { label: "جاری", className: "bg-fill text-accent" },
  delivered: { label: "تحویل شده", className: "bg-fill text-text-secondary" },
  cancelled: { label: "لغو شده", className: "bg-fill text-error" },
};

export default function StatusBadge({ status }: { status: OrderStatus }) {
  const item = MAP[status];
  return (
    <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full", item.className)}>
      {item.label}
    </span>
  );
}
