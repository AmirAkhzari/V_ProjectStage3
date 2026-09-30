import { describe, expect, it } from "vitest";
import { canCancel, canTransition, nextStatus, toClientStatus } from "./orderStatus";

describe("orderStatus", () => {
  it("walks the pipeline forward one step at a time", () => {
    expect(nextStatus("pending")).toBe("confirmed");
    expect(nextStatus("confirmed")).toBe("packing");
    expect(nextStatus("packing")).toBe("shipped");
    expect(nextStatus("shipped")).toBe("delivered");
    expect(nextStatus("delivered")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
  });

  it("only allows cancelling before shipment", () => {
    expect(canCancel("pending")).toBe(true);
    expect(canCancel("packing")).toBe(true);
    expect(canCancel("shipped")).toBe(false);
    expect(canCancel("delivered")).toBe(false);
  });

  it("rejects skipping steps", () => {
    expect(canTransition("pending", "shipped")).toBe(false);
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("shipped", "cancelled")).toBe(false);
  });

  it("maps to the client statuses", () => {
    expect(toClientStatus("packing")).toBe("current");
    expect(toClientStatus("delivered")).toBe("delivered");
    expect(toClientStatus("cancelled")).toBe("cancelled");
  });
});
