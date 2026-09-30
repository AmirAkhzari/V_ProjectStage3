// Fetch adapter for the driver endpoints specified in docs/DRIVER_DESIGN_PROPOSAL.md §18.
// The backend does not implement them yet; the default mode is `mock`.
import type {
  DriverNotification,
  DriverProfile,
  DriverSession,
  DriverStop,
  DriverTask,
  LoginError,
  SubmitCodeResult,
  TodaySummary,
} from "@/types";
import { NetworkError, UnauthorizedError, type DriverApi } from "./api";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787/v1";
const SESSION_KEY = "visitor-driver:session:v1";
const TIMEOUT_MS = 15_000;

function readSession(): DriverSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as DriverSession) : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  if (!navigator.onLine) throw new NetworkError("offline");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const session = readSession();
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...init.headers,
      },
    });
    if (res.status === 401) throw new UnauthorizedError("expired");
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "driver_inactive") throw new UnauthorizedError("inactive");
    }
    if (res.status >= 500) throw new NetworkError("server");
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NetworkError) throw err;
    if ((err as Error).name === "AbortError") throw new NetworkError("timeout");
    throw new NetworkError("offline");
  } finally {
    clearTimeout(timer);
  }
}

export const httpApi: DriverApi = {
  async login(username, password) {
    const { status, body } = await request<DriverSession | { error: LoginError }>("/driver/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (status !== 200 || "error" in body)
      return { ok: false, error: "error" in body ? body.error : "invalid_credentials" };
    localStorage.setItem(SESSION_KEY, JSON.stringify(body));
    return { ok: true, data: body };
  },

  async logout() {
    await request("/driver/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem(SESSION_KEY);
  },

  getSession: readSession,

  async getMe() {
    return (await request<DriverProfile>("/driver/me")).body;
  },

  async getToday() {
    return (await request<TodaySummary>("/driver/today")).body;
  },

  async getTask(deliveryId) {
    const { status, body } = await request<DriverTask>(`/driver/deliveries/${encodeURIComponent(deliveryId)}`);
    return status === 404 ? null : body;
  },

  async submitDeliveryCode(deliveryId, code, idempotencyKey) {
    const { body } = await request<SubmitCodeResult>(
      `/driver/deliveries/${encodeURIComponent(deliveryId)}/verification`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ code }) },
    );
    return body;
  },

  async getHistory(filter) {
    return (await request<DriverStop[]>(`/driver/deliveries?scope=history&status=${filter}`)).body;
  },

  async getNotifications() {
    return (await request<DriverNotification[]>("/driver/notifications")).body;
  },

  async markNotificationsRead(ids) {
    await request("/driver/notifications/read", { method: "POST", body: JSON.stringify({ ids: ids ?? null }) });
  },
};
