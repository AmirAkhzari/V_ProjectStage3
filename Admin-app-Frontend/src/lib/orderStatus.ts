import type { ClientOrderStatus, OrderStatus } from "@/types";

export const ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed", "packing", "shipped", "delivered", "cancelled"];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "در انتظار",
  confirmed: "تایید شده",
  packing: "در حال بسته‌بندی",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  cancelled: "لغو شده",
};

/** Label for the action button that moves an order forward. */
export const NEXT_ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: "تایید سفارش",
  packing: "شروع بسته‌بندی",
  shipped: "ثبت ارسال",
  delivered: "ثبت تحویل",
};

const FORWARD: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "packing",
  packing: "shipped",
  shipped: "delivered",
};

export function nextStatus(status: OrderStatus): OrderStatus | null {
  return FORWARD[status] ?? null;
}

export function canCancel(status: OrderStatus) {
  return status === "pending" || status === "confirmed" || status === "packing";
}

export function isTerminal(status: OrderStatus) {
  return status === "delivered" || status === "cancelled";
}

export function canTransition(from: OrderStatus, to: OrderStatus) {
  if (to === "cancelled") return canCancel(from);
  return FORWARD[from] === to;
}

/** Maps the admin pipeline to what the retailer PWA understands. */
export function toClientStatus(status: OrderStatus): ClientOrderStatus {
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";
  return "current";
}

export type BadgeTone = "neutral" | "solid" | "danger" | "muted";

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: "solid",
  confirmed: "neutral",
  packing: "neutral",
  shipped: "neutral",
  delivered: "muted",
  cancelled: "danger",
};
