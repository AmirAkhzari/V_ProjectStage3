import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/orderStatus";
import type { OrderStatus, PaymentStatus } from "@/types";

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const map: Record<
    PaymentStatus,
    {
      label: string;
      variant: "muted" | "danger" | "neutral";
    }
  > = {
    success: { label: "موفق", variant: "muted" },
    failed: { label: "ناموفق", variant: "danger" },
    pending: { label: "در انتظار", variant: "neutral" },
  };
  return <Badge variant={map[status].variant}>{map[status].label}</Badge>;
}

export function ActiveBadge({ active, labels = ["فعال", "غیرفعال"] }: { active: boolean; labels?: [string, string] }) {
  return <Badge variant={active ? "neutral" : "muted"}>{active ? labels[0] : labels[1]}</Badge>;
}
