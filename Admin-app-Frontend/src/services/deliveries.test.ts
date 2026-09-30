import { beforeEach, describe, expect, it } from "vitest";
import { mockApi } from "./mockApi";

async function asDistributorAdmin() {
  await mockApi.loginDemo("distributor_admin");
  mockApi.setScope({ distributorId: "d2" });
}

const orderByNumber = async (n: string) => (await mockApi.getOrders({ query: n }))[0];

describe("driver assignment and delivery confirmation (mock backend)", () => {
  beforeEach(async () => {
    localStorage.clear();
    await mockApi.resetDemoData();
    await asDistributorAdmin();
  });

  it("scopes drivers to the distributor", async () => {
    const drivers = await mockApi.getDrivers();
    expect(drivers.map((d) => d.id).sort()).toEqual(["drv_1", "drv_2", "drv_3"]);
    expect(await mockApi.getDriver("drv_4")).toBeNull();
  });

  it("only accepts active drivers of the order's own distributor", async () => {
    const order = await orderByNumber("VT-482233");
    expect(await mockApi.assignDriver(order.id, "drv_4")).toMatchObject({ ok: false });
    expect(await mockApi.assignDriver(order.id, "drv_3")).toMatchObject({ ok: false });
    const res = await mockApi.assignDriver(order.id, "drv_2");
    expect(res.ok && res.data.delivery).toMatchObject({ driverId: "drv_2", status: "assigned" });
  });

  it("closes the previous delivery as reassigned", async () => {
    const order = await orderByNumber("VT-482290");
    const res = await mockApi.assignDriver(order.id, "drv_2");
    expect(res.ok).toBe(true);
    const history = await mockApi.getDeliveries({ orderId: order.id });
    expect(history.find((d) => d.driverId === "drv_1")).toMatchObject({
      status: "cancelled",
      closedReason: "reassigned",
    });
  });

  it("does not let an admin mark a driver-bound order delivered manually", async () => {
    const order = await orderByNumber("VT-482290");
    expect(await mockApi.updateOrderStatus(order.id, "delivered")).toMatchObject({ ok: false });
  });

  it("confirming a verified delivery makes the order delivered", async () => {
    const res = await mockApi.confirmDelivery("dl_3");
    expect(res).toMatchObject({ ok: true, data: { status: "confirmed", confirmedByName: "سارا محمدی" } });
    expect((await orderByNumber("VT-482298")).status).toBe("delivered");
    expect(await mockApi.confirmDelivery("dl_3")).toMatchObject({ ok: false });
  });

  it("cannot confirm a delivery without a verified code", async () => {
    expect(await mockApi.confirmDelivery("dl_4")).toMatchObject({ ok: false });
  });

  it("rejecting keeps the order undelivered and requires a reason", async () => {
    expect(await mockApi.rejectDelivery("dl_3", "")).toMatchObject({ ok: false });
    expect(await mockApi.rejectDelivery("dl_3", "کارتن کم بود")).toMatchObject({
      ok: true,
      data: { status: "rejected" },
    });
    expect((await orderByNumber("VT-482298")).status).toBe("shipped");
  });

  it("blocks reassignment while a verification awaits review", async () => {
    const order = await orderByNumber("VT-482298");
    expect(await mockApi.assignDriver(order.id, "drv_2")).toMatchObject({ ok: false });
  });

  it("cancelling an order closes its delivery", async () => {
    const order = await orderByNumber("VT-482269");
    await mockApi.updateOrderStatus(order.id, "cancelled", "درخواست فروشگاه");
    const [d] = await mockApi.getDeliveries({ orderId: order.id });
    expect(d).toMatchObject({ status: "cancelled", closedReason: "order_cancelled" });
  });

  it("dispatching a route ships the driver's packing orders", async () => {
    const res = await mockApi.dispatchRoute("drv_1");
    expect(res).toEqual({ ok: true, data: { shipped: 1 } });
    expect((await orderByNumber("VT-482269")).status).toBe("shipped");
  });
});
