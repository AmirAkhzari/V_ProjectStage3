// Driver-facing contract. Delivery/order shapes mirror ../admin-FrontEnd/src/types/index.ts — keep them in sync.

/** Existing admin order pipeline. The driver never changes it; shown for context only. */
export type OrderStatus = "pending" | "confirmed" | "packing" | "shipped" | "delivered" | "cancelled";

/**
 * Lifecycle of one driver assignment for one order. Owned by the backend.
 * - assigned: on the driver's route, no accepted code yet
 * - awaiting_confirmation: backend accepted the delivery code; distributor admin must confirm
 * - confirmed: admin confirmed → order is `delivered`
 * - rejected: admin rejected the verification
 * - cancelled: order cancelled, or the driver was unassigned / the order was reassigned
 */
export type DeliveryStatus = "assigned" | "awaiting_confirmation" | "confirmed" | "rejected" | "cancelled";

export type DeliveryClosedReason = "order_cancelled" | "reassigned" | "unassigned";

export type VehicleInfo = {
  type: string;
  plate: string;
};

export type DriverProfile = {
  id: string;
  username: string;
  name: string;
  phone: string;
  distributorId: string;
  distributorName: string;
  distributorPhone: string;
  vehicle: VehicleInfo | null;
};

export type DriverSession = {
  token: string;
  driver: DriverProfile;
};

export type ShopInfo = {
  name: string;
  phone: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
};

/** One stop on the driver's route (list shape). */
export type DriverStop = {
  id: string;
  sequence: number;
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  status: DeliveryStatus;
  closedReason: DeliveryClosedReason | null;
  shop: ShopInfo;
  deliveryDate: string;
  deliverySlot: string;
  itemsCount: number;
  cartons: number;
  assignedAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  updatedAt: string;
};

export type DeliveryItem = {
  id: string;
  name: string;
  qty: number;
  unitsPerCarton: number;
};

/** Why the backend refuses code entry right now. `null` when `canSubmitCode` is true. */
export type SubmitBlockedReason =
  "not_dispatched" | "awaiting_confirmation" | "confirmed" | "rejected" | "cancelled" | "rate_limited";

export type DriverTask = DriverStop & {
  items: DeliveryItem[];
  instructions: string | null;
  verification: {
    codeLength: number;
    canSubmitCode: boolean;
    blockedReason: SubmitBlockedReason | null;
    attemptsRemaining: number;
    lockedUntil: string | null;
  };
};

export type TodaySummary = {
  date: string;
  stats: {
    total: number;
    confirmed: number;
    awaiting: number;
    remaining: number;
  };
  stops: DriverStop[];
};

export type VerifyOutcome =
  | "valid"
  | "invalid"
  | "rate_limited"
  | "already_submitted"
  | "already_confirmed"
  | "order_cancelled"
  | "not_assigned"
  | "not_dispatched";

export type SubmitCodeResult =
  | { ok: true; outcome: "valid"; task: DriverTask }
  | {
      ok: false;
      outcome: Exclude<VerifyOutcome, "valid">;
      attemptsRemaining: number | null;
      lockedUntil: string | null;
    };

export type LoginError = "invalid_credentials" | "inactive" | "too_many_attempts";

export type NotificationKind =
  | "task_assigned"
  | "route_updated"
  | "assignment_removed"
  | "order_cancelled"
  | "delivery_confirmed"
  | "delivery_rejected"
  | "instruction";

export type DriverNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  deliveryId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type HistoryFilter = "all" | "confirmed" | "awaiting_confirmation" | "rejected" | "cancelled";
