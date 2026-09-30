// localStorage-backed stand-in for the backend. Everything in this file plays the *server* role:
// codes, attempt counters and status transitions never leave it except as outcomes.
import type {
  DriverNotification,
  DriverSession,
  DriverStop,
  DriverTask,
  SubmitBlockedReason,
  SubmitCodeResult,
  TodaySummary,
} from "@/types";
import { NetworkError, UnauthorizedError, type DriverApi } from "./api";
import { SEED_DELIVERIES, SEED_DRIVERS, SEED_NOTIFICATIONS, type DriverAccount, type SeedDelivery } from "./seed";
import { createId, toAsciiDigits } from "@/lib/format";

const KEY = "visitor-driver:db:v1";
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_LOCK_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;

type Attempts = { count: number; lockedUntil: string | null };

type Db = {
  session: DriverSession | null;
  drivers: DriverAccount[];
  deliveries: SeedDelivery[];
  notifications: Array<DriverNotification & { driverId: string }>;
  attempts: Record<string, Attempts>;
  loginAttempts: Record<string, number>;
  idempotency: Record<string, SubmitCodeResult>;
};

const delay = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

function seedDb(): Db {
  return {
    session: null,
    drivers: structuredClone(SEED_DRIVERS),
    deliveries: structuredClone(SEED_DELIVERIES),
    notifications: structuredClone(SEED_NOTIFICATIONS),
    attempts: {},
    loginAttempts: {},
    idempotency: {},
  };
}

let cache: Db | null = null;

function readDb(): Db {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...seedDb(), ...(JSON.parse(raw) as Partial<Db>) } : seedDb();
  } catch {
    cache = seedDb();
  }
  return cache;
}

function writeDb(db: Db) {
  cache = db;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* quota exceeded in demo — keep in-memory */
  }
}

/** Simulates transport failures so offline states can be exercised in the demo (DevTools → Offline). */
async function transport(ms?: number) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new NetworkError("offline");
  await delay(ms);
}

function requireDriver(db: Db): DriverAccount {
  const session = db.session;
  if (!session) throw new UnauthorizedError("expired");
  const driver = db.drivers.find((d) => d.id === session.driver.id);
  if (!driver) throw new UnauthorizedError("expired");
  if (!driver.active) throw new UnauthorizedError("inactive");
  return driver;
}

function isSameDay(iso: string, ref = new Date()) {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

function toStop(d: SeedDelivery): DriverStop {
  const { driverId: _driverId, items: _items, instructions: _instructions, code: _code, ...stop } = d;
  return stop;
}

function currentAttempts(db: Db, deliveryId: string): Attempts {
  const a = db.attempts[deliveryId];
  if (!a) return { count: 0, lockedUntil: null };
  if (a.lockedUntil && new Date(a.lockedUntil).getTime() <= Date.now()) {
    db.attempts[deliveryId] = { count: 0, lockedUntil: null };
    return db.attempts[deliveryId];
  }
  return a;
}

function blockedReason(db: Db, d: SeedDelivery): SubmitBlockedReason | null {
  if (d.status === "cancelled" || d.orderStatus === "cancelled") return "cancelled";
  if (d.status === "awaiting_confirmation") return "awaiting_confirmation";
  if (d.status === "confirmed") return "confirmed";
  if (d.status === "rejected") return "rejected";
  if (d.orderStatus !== "shipped") return "not_dispatched";
  if (currentAttempts(db, d.id).lockedUntil) return "rate_limited";
  return null;
}

function toTask(db: Db, d: SeedDelivery): DriverTask {
  const attempts = currentAttempts(db, d.id);
  const reason = blockedReason(db, d);
  return {
    ...toStop(d),
    items: d.items,
    instructions: d.instructions,
    verification: {
      codeLength: d.code.length,
      canSubmitCode: reason === null,
      blockedReason: reason,
      attemptsRemaining: Math.max(0, MAX_CODE_ATTEMPTS - attempts.count),
      lockedUntil: attempts.lockedUntil,
    },
  };
}

export const mockApi: DriverApi = {
  async login(username, password) {
    await transport(420);
    const db = readDb();
    const key = username.trim().toLowerCase();
    if ((db.loginAttempts[key] ?? 0) >= MAX_LOGIN_ATTEMPTS) return { ok: false, error: "too_many_attempts" };
    const driver = db.drivers.find((d) => d.username === key);
    if (!driver || driver.password !== toAsciiDigits(password)) {
      db.loginAttempts[key] = (db.loginAttempts[key] ?? 0) + 1;
      writeDb(db);
      return { ok: false, error: "invalid_credentials" };
    }
    if (!driver.active) return { ok: false, error: "inactive" };
    delete db.loginAttempts[key];
    const { password: _password, active: _active, ...profile } = driver;
    db.session = { token: createId("drvtok"), driver: profile };
    writeDb(db);
    return { ok: true, data: db.session };
  },

  async logout() {
    const db = readDb();
    db.session = null;
    writeDb(db);
  },

  getSession() {
    return readDb().session;
  },

  async getMe() {
    await transport(120);
    const db = readDb();
    const { password: _password, active: _active, ...profile } = requireDriver(db);
    return profile;
  },

  async getToday() {
    await transport();
    const db = readDb();
    const driver = requireDriver(db);
    const stops = db.deliveries
      .filter((d) => d.driverId === driver.id && isSameDay(d.deliveryDate))
      .sort((a, b) => a.sequence - b.sequence)
      .map(toStop);
    const active = stops.filter((s) => s.status !== "cancelled");
    const summary: TodaySummary = {
      date: new Date().toISOString(),
      stats: {
        total: active.length,
        confirmed: active.filter((s) => s.status === "confirmed").length,
        awaiting: active.filter((s) => s.status === "awaiting_confirmation").length,
        remaining: active.filter((s) => s.status === "assigned" || s.status === "rejected").length,
      },
      stops,
    };
    return summary;
  },

  async getTask(deliveryId) {
    await transport(200);
    const db = readDb();
    const driver = requireDriver(db);
    const d = db.deliveries.find((x) => x.id === deliveryId);
    // Another driver's (or another tenant's) delivery is indistinguishable from a missing one.
    if (!d || d.driverId !== driver.id) return null;
    return toTask(db, d);
  },

  async submitDeliveryCode(deliveryId, rawCode, idempotencyKey) {
    await transport(700);
    const db = readDb();
    const driver = requireDriver(db);
    const replay = db.idempotency[idempotencyKey];
    if (replay) return replay;

    const remember = (result: SubmitCodeResult) => {
      db.idempotency[idempotencyKey] = result;
      writeDb(db);
      return result;
    };
    const failure = (
      outcome: Exclude<SubmitCodeResult["outcome"], "valid">,
      extra: { attemptsRemaining?: number | null; lockedUntil?: string | null } = {},
    ): SubmitCodeResult => ({
      ok: false,
      outcome,
      attemptsRemaining: extra.attemptsRemaining ?? null,
      lockedUntil: extra.lockedUntil ?? null,
    });

    const d = db.deliveries.find((x) => x.id === deliveryId);
    if (!d || d.driverId !== driver.id || (d.status === "cancelled" && d.closedReason !== "order_cancelled"))
      return remember(failure("not_assigned"));
    if (d.status === "cancelled" || d.orderStatus === "cancelled") return remember(failure("order_cancelled"));
    if (d.status === "confirmed") return remember(failure("already_confirmed"));
    if (d.status === "awaiting_confirmation") return remember(failure("already_submitted"));
    if (d.status === "rejected") return remember(failure("not_assigned"));
    if (d.orderStatus !== "shipped") return remember(failure("not_dispatched"));

    const attempts = currentAttempts(db, d.id);
    if (attempts.lockedUntil)
      return remember(failure("rate_limited", { attemptsRemaining: 0, lockedUntil: attempts.lockedUntil }));

    const code = toAsciiDigits(rawCode).replace(/\D/g, "");
    if (code !== d.code) {
      const count = attempts.count + 1;
      const lockedUntil =
        count >= MAX_CODE_ATTEMPTS ? new Date(Date.now() + CODE_LOCK_MINUTES * 60_000).toISOString() : null;
      db.attempts[d.id] = { count, lockedUntil };
      return remember(
        lockedUntil
          ? failure("rate_limited", { attemptsRemaining: 0, lockedUntil })
          : failure("invalid", { attemptsRemaining: MAX_CODE_ATTEMPTS - count }),
      );
    }

    const now = new Date().toISOString();
    d.status = "awaiting_confirmation";
    d.submittedAt = now;
    d.updatedAt = now;
    delete db.attempts[d.id];
    return remember({ ok: true, outcome: "valid", task: toTask(db, d) });
  },

  async getHistory(filter) {
    await transport();
    const db = readDb();
    const driver = requireDriver(db);
    return db.deliveries
      .filter((d) => d.driverId === driver.id && d.status !== "assigned")
      .filter((d) => filter === "all" || d.status === filter)
      .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || a.sequence - b.sequence)
      .map(toStop);
  },

  async getNotifications() {
    await transport(160);
    const db = readDb();
    const driver = requireDriver(db);
    return db.notifications
      .filter((n) => n.driverId === driver.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ driverId: _driverId, ...n }) => n);
  },

  async markNotificationsRead(ids) {
    await transport(80);
    const db = readDb();
    const driver = requireDriver(db);
    const now = new Date().toISOString();
    db.notifications = db.notifications.map((n) =>
      n.driverId === driver.id && !n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: now } : n,
    );
    writeDb(db);
  },
};

export function resetMockDb() {
  const session = readDb().session;
  const db = seedDb();
  db.session = session;
  writeDb(db);
}

/** Demo-only helper for the login screen's guide. Never used by delivery screens. */
export function demoOpenCodes() {
  return readDb()
    .deliveries.filter((d) => d.driverId === "drv_1" && d.status === "assigned" && d.orderStatus === "shipped")
    .sort((a, b) => a.sequence - b.sequence)
    .map((d) => ({ shop: d.shop.name, orderNumber: d.orderNumber, code: d.code }));
}
