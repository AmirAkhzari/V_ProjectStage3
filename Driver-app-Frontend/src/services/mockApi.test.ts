import { beforeEach, describe, expect, it } from "vitest";
import { CODE_LOCK_MINUTES, MAX_CODE_ATTEMPTS, mockApi, resetMockDb } from "./mockApi";
import { DEMO_PASSWORD } from "./seed";
import { UnauthorizedError } from "./api";

async function loginAli() {
  const res = await mockApi.login("ali.rezaei", DEMO_PASSWORD);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe("driver mock backend", () => {
  beforeEach(async () => {
    localStorage.clear();
    await mockApi.logout();
    resetMockDb();
  });

  it("rejects wrong credentials and inactive drivers", async () => {
    expect(await mockApi.login("ali.rezaei", "nope")).toEqual({ ok: false, error: "invalid_credentials" });
    expect(await mockApi.login("hamid.nouri", DEMO_PASSWORD)).toEqual({ ok: false, error: "inactive" });
  });

  it("requires a session for driver data", async () => {
    await expect(mockApi.getToday()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns only the logged-in driver's stops, in route order", async () => {
    await loginAli();
    const today = await mockApi.getToday();
    expect(today.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(today.stats).toEqual({ total: 7, confirmed: 2, awaiting: 1, remaining: 4 });
    expect(await mockApi.getTask("dl_r1")).toBeNull();
  });

  it("never exposes the delivery code to the client", async () => {
    await loginAli();
    const task = await mockApi.getTask("dl_4");
    expect(JSON.stringify(task)).not.toContain("482615");
    expect(task?.verification).toMatchObject({ codeLength: 6, canSubmitCode: true, blockedReason: null });
  });

  it("moves a delivery to awaiting_confirmation on a valid code, not to delivered", async () => {
    await loginAli();
    const res = await mockApi.submitDeliveryCode("dl_4", "۴۸۲۶۱۵", "k1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.task.status).toBe("awaiting_confirmation");
    expect(res.task.orderStatus).toBe("shipped");
    const again = await mockApi.submitDeliveryCode("dl_4", "482615", "k2");
    expect(again).toMatchObject({ ok: false, outcome: "already_submitted" });
  });

  it("replays the same result for a repeated idempotency key", async () => {
    await loginAli();
    const first = await mockApi.submitDeliveryCode("dl_5", "111111", "same");
    const second = await mockApi.submitDeliveryCode("dl_5", "111111", "same");
    expect(second).toEqual(first);
    expect(first).toMatchObject({ outcome: "invalid", attemptsRemaining: MAX_CODE_ATTEMPTS - 1 });
  });

  it("locks code entry after too many invalid attempts", async () => {
    await loginAli();
    let last;
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) last = await mockApi.submitDeliveryCode("dl_6", "000001", `k${i}`);
    expect(last).toMatchObject({ ok: false, outcome: "rate_limited", attemptsRemaining: 0 });
    const lockedUntil = new Date((last as { lockedUntil: string }).lockedUntil).getTime();
    expect(lockedUntil - Date.now()).toBeGreaterThan((CODE_LOCK_MINUTES - 1) * 60_000);
    const correct = await mockApi.submitDeliveryCode("dl_6", "338061", "after-lock");
    expect(correct).toMatchObject({ ok: false, outcome: "rate_limited" });
  });

  it("refuses codes for cancelled, undispatched and foreign deliveries", async () => {
    await loginAli();
    expect(await mockApi.submitDeliveryCode("dl_8", "127594", "a")).toMatchObject({ outcome: "order_cancelled" });
    expect(await mockApi.submitDeliveryCode("dl_7", "649280", "b")).toMatchObject({ outcome: "not_dispatched" });
    expect(await mockApi.submitDeliveryCode("dl_r1", "555111", "c")).toMatchObject({ outcome: "not_assigned" });
    expect(await mockApi.submitDeliveryCode("dl_1", "503118", "d")).toMatchObject({ outcome: "already_confirmed" });
  });
});
