import { Badge } from "@/components/ui/badge";
import { CLOSED_REASON_LABELS, DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONE } from "@/lib/deliveryStatus";
import type { DeliveryClosedReason, DeliveryStatus } from "@/types";

export default function DeliveryStatusBadge({
  status,
  closedReason,
}: {
  status: DeliveryStatus;
  closedReason?: DeliveryClosedReason | null;
}) {
  const label =
    status === "cancelled" && closedReason ? CLOSED_REASON_LABELS[closedReason] : DELIVERY_STATUS_LABELS[status];
  return <Badge variant={DELIVERY_STATUS_TONE[status]}>{label}</Badge>;
}
