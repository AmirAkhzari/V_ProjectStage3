import { ApiClientError } from "@/lib/apiError";
import { toAsciiDigits, toFaDigits } from "@/lib/format";

/** shape: v1.2.1-draft@2026-11-22. Provisional. Not an OpenAPI change. */

declare const fullAccount: unique symbol;
declare const maskedAccount: unique symbol;

/** Full PAN/IBAN. Only the payer's own payment view may render this. */
export type FullAccountNumber = string & { readonly [fullAccount]: "full" };
/** Backend-masked value. Every non-payer view accepts only this. */
export type MaskedAccountNumber = string & { readonly [maskedAccount]: "masked" };

export function asFullAccount(value: string): FullAccountNumber { return value as FullAccountNumber; }
export function asMaskedAccount(value: string): MaskedAccountNumber { return value as MaskedAccountNumber; }

export type CardPaymentSnapshot = {
  id: string; amount: number; status: string; deadline_at: string | null; sla_due_at: string | null; cool_down_ends_at: string | null;
  destination: { full_account: FullAccountNumber; masked_account: MaskedAccountNumber; holder_name: string; bank_name: string };
  reject_reason: string | null;
};

export type MaskedPaymentRow = { id: string; status: string; masked_account: MaskedAccountNumber; holder_name: string; bank_name: string };

export type ReceiptBody = { name: string; mime: string; size: number; body: Blob };

export interface CardPaymentApi {
  getPayment(id: string): Promise<CardPaymentSnapshot>;
  submitReceipt(id: string, body: { tracking: string; receipt: ReceiptBody }, idempotencyKey: string): Promise<CardPaymentSnapshot>;
}

export const PAYMENT_STATUSES = ["pending", "pending_verification", "success", "failed", "expired"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Admin PaymentStatus is only success|failed|pending. Do not import it. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "در انتظار پرداخت",
  pending_verification: "در حال بررسی",
  success: "تأیید شده",
  failed: "ناموفق",
  expired: "منقضی شده",
};

const STATUS_ICON = {
  pending: "clock",
  pending_verification: "search",
  success: "check",
  failed: "cross",
  expired: "calendar",
} as const satisfies Record<PaymentStatus, string>;

export type StatusIcon = (typeof STATUS_ICON)[PaymentStatus] | "question";

const UNKNOWN_LABEL = "نامشخص";
const loggedUnknown = new Set<string>();

export function resetStatusLogForTests() {
  loggedUnknown.clear();
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function describeStatus(value: string, screen: string) {
  if (isPaymentStatus(value)) {
    return { known: true as const, status: value, label: PAYMENT_STATUS_LABELS[value], icon: STATUS_ICON[value] };
  }
  const key = `${screen}\n${value}`;
  if (!loggedUnknown.has(key)) {
    loggedUnknown.add(key);
    console.warn("card-payment-status", { screen, status: value });
  }
  return { known: false as const, status: null, label: UNKNOWN_LABEL, icon: "question" as const };
}

const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function plainText(value: string) {
  return value.replace(BIDI, "");
}

const tehranFormat = new Intl.DateTimeFormat("fa-IR", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTehran(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return tehranFormat.format(date);
}

export function tehranHourMinute(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function formatRemain(ms: number) {
  if (ms <= 0) return "در انتظار به‌روزرسانی";
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${toFaDigits(minutes)}:${toFaDigits(seconds)}`;
}

export function normalizeTracking(raw: string) {
  return toAsciiDigits(plainText(raw)).replace(/[\s\-_./]/g, "");
}

/** v1.2.1 has not frozen raw vs normalized. Change this return to flip what is sent. */
export function trackingToSend(raw: string) {
  return normalizeTracking(raw);
}

export function trackingHint(raw: string) {
  return /^\d{6,20}$/.test(normalizeTracking(raw)) ? null : "شماره پیگیری باید ۶ تا ۲۰ رقم باشد.";
}

const RECEIPT_EXT = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
const RECEIPT_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export function receiptPrecheck(file: { name: string; type: string; size: number } | null) {
  if (!file) return "رسید را انتخاب کنید.";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!RECEIPT_EXT.has(ext) || !RECEIPT_MIME.has(file.type)) return "فقط JPEG، PNG، WebP یا PDF مجاز است.";
  if (file.size > 5 * 1024 * 1024) return "حجم فایل بیشتر از ۵ مگابایت است.";
  return null;
}

export const CONTRACT_ERROR_CODES = [
  "VALIDATION_FAILED", "UNAUTHENTICATED", "TOKEN_TYPE_MISMATCH", "SESSION_REVOKED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED",
  "IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_REUSE", "IDEMPOTENCY_IN_PROGRESS", "invalid_credentials", "too_many_attempts",
  "driver_inactive", "PASSWORD_CHANGE_REQUIRED", "CURRENT_PASSWORD_INVALID", "PASSWORD_REUSED", "PASSWORD_TOO_SHORT",
  "PASSWORD_BREACHED", "USERNAME_TAKEN", "USERNAME_INVALID", "session_expired", "OTP_INVALID", "OTP_LOCKED",
  "MARKETPLACE_REQUIRES_PRO", "DISTRIBUTOR_LOCKED", "UNAVAILABLE_ITEMS", "MOQ_NOT_MET", "MIN_ORDER", "PRICE_CHANGED",
  "CAPACITY_UNAVAILABLE", "INVALID_TRANSITION", "ORDER_NOT_PAID", "ORDER_NOT_CANCELLABLE", "ORDER_NOT_SHIPPED",
  "ACTIVE_DELIVERY_EXISTS", "REASON_REQUIRED", "REASON_TOO_LONG", "DELIVERY_NOT_ACTIVE", "DELIVERY_AWAITING_CONFIRMATION",
  "DELIVERY_LOCKED", "PAYMENT_VERIFICATION_PENDING", "PAYMENT_NOT_STARTABLE", "PAYMENT_AMOUNT_MISMATCH", "REFUND_EXISTS",
  "TOO_MANY_PENDING_PAYMENTS", "REFUND_NOT_FOUND", "WALLET_INSUFFICIENT", "SERVICE_UNAVAILABLE", "INTERNAL", "DEPENDENCY_UNAVAILABLE",
] as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];

/** Not in ERROR_CODES. 503 is handled from the HTTP status alone until v1.2.1 names one. */
export const provisionalCodes = ["SCANNER_UNAVAILABLE"] as const;

const GENERIC = "خطایی رخ داد. دوباره تلاش کنید.";
const CODE_MESSAGE: Partial<Record<ContractErrorCode, string>> = {
  UNAUTHENTICATED: "برای ادامه باید دوباره وارد شوید.",
  RATE_LIMITED: "تعداد درخواست بیش از حد مجاز است.",
  VALIDATION_FAILED: "اطلاعات واردشده معتبر نیست.",
  NOT_FOUND: "موردی پیدا نشد.",
  FORBIDDEN: "اجازه این کار را ندارید.",
};

export function messageForCode(code: string | undefined) {
  if (code && (CONTRACT_ERROR_CODES as readonly string[]).includes(code)) {
    return CODE_MESSAGE[code as ContractErrorCode] ?? GENERIC;
  }
  return GENERIC;
}

export function parseRetryAfter(header: string | null | undefined, now: number) {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return now + Number(trimmed) * 1000;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export type CardPaymentNotice = {
  message: string;
  disableSubmit: boolean;
  autoRetry: false;
  retryAt: number | null;
  reauth: boolean;
};

const payments = new Map<string, CardPaymentSnapshot>();
const cleaners = new Set<() => void>();
let reauthStarted = false;

export function rememberPayment(payment: CardPaymentSnapshot) { payments.set(payment.id, payment); }
export function readPayment(id: string) { return payments.get(id); }
export function registerCardPaymentCleaner(fn: () => void) { cleaners.add(fn); }
export function clearCardPaymentState() { payments.clear(); for (const fn of cleaners) fn(); }
export function noteCardPaymentAuthed() { reauthStarted = false; }
export function resetCardPaymentReauthForTests() { reauthStarted = false; }

export function submitBlocked(notice: CardPaymentNotice | null, now: number) {
  if (!notice?.disableSubmit) return false;
  if (notice.retryAt == null) return true;
  return notice.retryAt > now;
}

export async function handleCardPaymentError(
  err: unknown,
  deps: { logout: () => Promise<void> | void; redirect: (path: string) => void; now?: number },
): Promise<CardPaymentNotice> {
  const status = err instanceof ApiClientError ? err.status : undefined;
  const code = err instanceof ApiClientError ? err.code : undefined;
  const now = deps.now ?? Date.now();
  const retryAt = parseRetryAfter(err instanceof ApiClientError ? err.retryAfter : null, now);
  if (status === 401 && code === "UNAUTHENTICATED") {
    if (!reauthStarted) {
      reauthStarted = true;
      clearCardPaymentState();
      await deps.logout();
      deps.redirect("/login");
    }
    return { message: messageForCode("UNAUTHENTICATED"), disableSubmit: true, autoRetry: false, retryAt: null, reauth: true };
  }
  if (status === 429 && code === "RATE_LIMITED") {
    return { message: messageForCode("RATE_LIMITED"), disableSubmit: true, autoRetry: false, retryAt, reauth: false };
  }
  if (status === 503) {
    return { message: "بعداً دوباره تلاش کنید", disableSubmit: false, autoRetry: false, retryAt, reauth: false };
  }
  return { message: messageForCode(code), disableSubmit: false, autoRetry: false, retryAt: null, reauth: false };
}

const unwired: CardPaymentApi = {
  async getPayment() {
    throw new ApiClientError("unwired", "SERVICE_UNAVAILABLE", 503);
  },
  async submitReceipt() {
    throw new ApiClientError("unwired", "SERVICE_UNAVAILABLE", 503);
  },
};

/** Build-time gate. Production DEV is false, so the mock import is dropped. The flag defaults off. */
export function loadCardPaymentApi(): Promise<CardPaymentApi> {
  if (import.meta.env.DEV) {
    if (import.meta.env.VITE_CARD_PAYMENTS_MOCK === "1") {
      return import("./mock/cardPaymentMock").then((mod) => mod.cardPaymentMock);
    }
  }
  return Promise.resolve(unwired);
}

export { assertProductionMockOff } from "./mockGate";
