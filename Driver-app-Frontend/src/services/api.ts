import type {
  DriverNotification,
  DriverProfile,
  DriverSession,
  DriverStop,
  DriverTask,
  HistoryFilter,
  LoginError,
  SubmitCodeResult,
  TodaySummary,
} from "@/types";

export type ApiOk<T> = { ok: true; data: T };
export type ApiFail<E extends string = string> = { ok: false; error: E };
export type ApiResult<T, E extends string = string> = ApiOk<T> | ApiFail<E>;

/** Thrown by the transport when the backend cannot be reached or answers too late. */
export class NetworkError extends Error {
  constructor(public readonly kind: "offline" | "timeout" | "server") {
    super(kind);
  }
}

/** Thrown when the session is no longer valid (expired token, driver deactivated). */
export class UnauthorizedError extends Error {
  constructor(public readonly reason: "expired" | "inactive") {
    super(reason);
  }
}

/**
 * Driver API contract. Every call is scoped server-side to the authenticated driver
 * and their distributor; the client never sends a driver or distributor id.
 */
export interface DriverApi {
  login(username: string, password: string): Promise<ApiResult<DriverSession, LoginError>>;
  logout(): Promise<void>;
  getSession(): DriverSession | null;

  getMe(): Promise<DriverProfile>;
  getToday(): Promise<TodaySummary>;
  getTask(deliveryId: string): Promise<DriverTask | null>;
  /** `idempotencyKey` makes a retried submission (double tap, timeout retry) safe. */
  submitDeliveryCode(deliveryId: string, code: string, idempotencyKey: string): Promise<SubmitCodeResult>;
  getHistory(filter: HistoryFilter): Promise<DriverStop[]>;

  getNotifications(): Promise<DriverNotification[]>;
  markNotificationsRead(ids?: string[]): Promise<void>;
}
