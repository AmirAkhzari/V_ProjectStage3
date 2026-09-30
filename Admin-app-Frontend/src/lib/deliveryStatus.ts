import type { DeliveryClosedReason, DeliveryStatus, DeliverySummary, OrderStatus } from "@/types";
import type { BadgeTone } from "./orderStatus";

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  assigned: "در مسیر راننده",
  awaiting_confirmation: "در انتظار تایید تحویل",
  confirmed: "تحویل تایید شد",
  rejected: "تایید رد شد",
  cancelled: "بسته شد",
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, BadgeTone> = {
  assigned: "neutral",
  awaiting_confirmation: "solid",
  confirmed: "muted",
  rejected: "danger",
  cancelled: "muted",
};

export const CLOSED_REASON_LABELS: Record<DeliveryClosedReason, string> = {
  order_cancelled: "سفارش لغو شد",
  reassigned: "به راننده دیگر سپرده شد",
  unassigned: "از راننده برداشته شد",
};

/** Order statuses in which a driver can be (re)assigned. Mirrors the backend rule. */
export const ASSIGNABLE_ORDER_STATUSES: OrderStatus[] = ["confirmed", "packing", "shipped"];

/** Deliveries that still occupy the order (block a second assignment or a manual status change). */
export function isActiveDelivery(d: Pick<DeliverySummary, "status"> | null | undefined) {
  return d?.status === "assigned" || d?.status === "awaiting_confirmation";
}

/** Why the driver selector is locked for this order, or null when assignment is allowed. */
export function assignmentLockReason(orderStatus: OrderStatus, delivery: DeliverySummary | null | undefined) {
  if (orderStatus === "delivered") return "سفارش تحویل شده است";
  if (orderStatus === "cancelled") return "سفارش لغو شده است";
  if (orderStatus === "pending") return "ابتدا سفارش را تایید کنید";
  if (delivery?.status === "awaiting_confirmation") return "تحویل در انتظار تایید شماست";
  return null;
}
