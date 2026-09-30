import type { DriverStop, HistoryFilter, SubmitBlockedReason } from "@/types";

/**
 * Presentation state of a stop, derived from backend fields only (`status`, `orderStatus`,
 * `closedReason`) plus the route order. It never decides whether an action is allowed —
 * `DriverTask.verification.canSubmitCode` does.
 */
export type StopUiState =
  "next" | "ready" | "not_dispatched" | "awaiting" | "done" | "rejected" | "cancelled" | "reassigned";

export type PillTone = "solid" | "neutral" | "muted" | "danger";

export const STOP_STATE_META: Record<StopUiState, { label: string; tone: PillTone }> = {
  next: { label: "توقف بعدی", tone: "solid" },
  ready: { label: "در انتظار تحویل", tone: "neutral" },
  not_dispatched: { label: "در حال آماده‌سازی", tone: "muted" },
  awaiting: { label: "در انتظار تایید مدیر", tone: "neutral" },
  done: { label: "تحویل تایید شد", tone: "muted" },
  rejected: { label: "رد شد", tone: "danger" },
  cancelled: { label: "سفارش لغو شد", tone: "muted" },
  reassigned: { label: "از مسیر شما حذف شد", tone: "muted" },
};

export function isOpenStop(stop: DriverStop) {
  return stop.status === "assigned";
}

/** First open, dispatched stop in route order; falls back to the first open stop. */
export function findNextStop(stops: DriverStop[]) {
  const open = stops.filter(isOpenStop).sort((a, b) => a.sequence - b.sequence);
  return open.find((s) => s.orderStatus === "shipped") ?? open[0] ?? null;
}

export function stopUiState(stop: DriverStop, nextId?: string | null): StopUiState {
  switch (stop.status) {
    case "awaiting_confirmation":
      return "awaiting";
    case "confirmed":
      return "done";
    case "rejected":
      return "rejected";
    case "cancelled":
      return stop.closedReason === "order_cancelled" ? "cancelled" : "reassigned";
    case "assigned":
      if (stop.orderStatus !== "shipped") return "not_dispatched";
      return stop.id === nextId ? "next" : "ready";
  }
}

export const BLOCKED_REASON_COPY: Record<SubmitBlockedReason, { title: string; body: string }> = {
  not_dispatched: {
    title: "هنوز ارسال نشده",
    body: "این سفارش هنوز از انبار ارسال نشده است. پس از ثبت ارسال توسط مدیر، ثبت کد تحویل فعال می‌شود.",
  },
  awaiting_confirmation: {
    title: "در انتظار تایید مدیر",
    body: "کد تحویل صحیح بود و تحویل برای تأیید مدیر ثبت شد. نیازی به اقدام دیگری نیست.",
  },
  confirmed: {
    title: "تحویل تایید شد",
    body: "مدیر شرکت پخش این تحویل را تایید کرد.",
  },
  rejected: {
    title: "تحویل رد شد",
    body: "مدیر تایید این تحویل را رد کرد. برای ادامه با مدیر شرکت پخش تماس بگیرید.",
  },
  cancelled: {
    title: "این توقف بسته شده است",
    body: "این سفارش دیگر در مسیر شما نیست و نیازی به تحویل ندارد.",
  },
  rate_limited: {
    title: "ثبت کد موقتاً قفل شد",
    body: "تعداد تلاش‌های ناموفق بیش از حد مجاز بود. کمی بعد دوباره تلاش کنید یا با مدیر تماس بگیرید.",
  },
};

export const HISTORY_FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "همه" },
  { id: "confirmed", label: "تاییدشده" },
  { id: "awaiting_confirmation", label: "در انتظار تایید" },
  { id: "rejected", label: "ردشده" },
  { id: "cancelled", label: "لغو و واگذاری" },
];
