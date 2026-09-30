import { describe, expect, it } from "vitest";
import { findNextStop, stopUiState } from "./deliveryStatus";
import type { DriverStop } from "@/types";

const base: DriverStop = {
  id: "s",
  sequence: 1,
  orderId: "o",
  orderNumber: "VT-1",
  orderStatus: "shipped",
  status: "assigned",
  closedReason: null,
  shop: { name: "x", phone: "", address: "", city: "", lat: null, lng: null },
  deliveryDate: new Date().toISOString(),
  deliverySlot: "10:00",
  itemsCount: 1,
  cartons: 1,
  assignedAt: "",
  submittedAt: null,
  confirmedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  updatedAt: "",
};
const s = (o: Partial<DriverStop>): DriverStop => ({ ...base, ...o });

describe("deliveryStatus", () => {
  it("picks the first dispatched open stop as next", () => {
    const stops = [
      s({ id: "a", sequence: 1, status: "confirmed" }),
      s({ id: "b", sequence: 2, orderStatus: "packing" }),
      s({ id: "c", sequence: 3 }),
    ];
    expect(findNextStop(stops)?.id).toBe("c");
  });

  it("falls back to an undispatched stop when nothing is shipped", () => {
    expect(findNextStop([s({ id: "b", orderStatus: "packing" })])?.id).toBe("b");
    expect(findNextStop([s({ status: "awaiting_confirmation" })])).toBeNull();
  });

  it("maps backend statuses to UI states", () => {
    expect(stopUiState(s({ id: "n" }), "n")).toBe("next");
    expect(stopUiState(s({}))).toBe("ready");
    expect(stopUiState(s({ orderStatus: "confirmed" }))).toBe("not_dispatched");
    expect(stopUiState(s({ status: "awaiting_confirmation" }))).toBe("awaiting");
    expect(stopUiState(s({ status: "confirmed" }))).toBe("done");
    expect(stopUiState(s({ status: "rejected" }))).toBe("rejected");
    expect(stopUiState(s({ status: "cancelled", closedReason: "order_cancelled" }))).toBe("cancelled");
    expect(stopUiState(s({ status: "cancelled", closedReason: "reassigned" }))).toBe("reassigned");
  });
});
