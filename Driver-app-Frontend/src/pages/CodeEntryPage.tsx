import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CircleCheck, CloudOff, Hourglass, Lock, TriangleAlert } from "lucide-react";
import BackHeader from "@/components/layout/BackHeader";
import QueryError from "@/components/QueryError";
import Button from "@/components/ui/Button";
import CodeSlots from "@/components/ui/CodeSlots";
import Skeleton from "@/components/ui/Skeleton";
import { useSubmitDeliveryCode, useTask, useToday } from "@/features/queries";
import { findNextStop } from "@/lib/deliveryStatus";
import { createId, toAsciiDigits, toFaNum } from "@/lib/format";
import { formatTime } from "@/lib/jalali";
import { NetworkError } from "@/services/api";
import type { DriverTask, SubmitCodeResult } from "@/types";

type Feedback =
  | { kind: "invalid"; attemptsRemaining: number | null }
  | { kind: "rate_limited"; lockedUntil: string | null }
  | { kind: "offline" }
  | { kind: "unknown" }
  | { kind: "closed"; outcome: Exclude<SubmitCodeResult["outcome"], "valid" | "invalid" | "rate_limited"> };

const CLOSED_COPY: Record<Extract<Feedback, { kind: "closed" }>["outcome"], string> = {
  already_submitted: "کد این تحویل قبلاً ثبت شده و در انتظار تایید مدیر است.",
  already_confirmed: "این تحویل قبلاً توسط مدیر تایید شده است.",
  order_cancelled: "این سفارش لغو شده است و نیازی به تحویل ندارد.",
  not_assigned: "این سفارش دیگر به شما سپرده نشده است.",
  not_dispatched: "این سفارش هنوز از انبار ارسال نشده است.",
};

export default function CodeEntryPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { data: task, isLoading, error, refetch } = useTask(id);
  const [done, setDone] = useState<DriverTask | null>(null);

  if (done) return <SuccessView task={done} />;
  if (isLoading) {
    return (
      <>
        <BackHeader title="ثبت کد تحویل" />
        <div className="space-y-4 p-5">
          <Skeleton className="h-16" />
          <Skeleton className="h-[72px]" />
        </div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <BackHeader title="ثبت کد تحویل" />
        <QueryError error={error} onRetry={() => void refetch()} />
      </>
    );
  }
  if (!task) return <Navigate to={`/tasks/${id}`} replace />;
  if (task.status === "awaiting_confirmation") return <SuccessView task={task} />;
  if (!task.verification.canSubmitCode && task.verification.blockedReason !== "rate_limited")
    return <Navigate to={`/tasks/${id}`} replace />;

  return <CodeForm task={task} onValid={setDone} onRecheck={() => refetch()} />;
}

function CodeForm({
  task,
  onValid,
  onRecheck,
}: {
  task: DriverTask;
  onValid: (task: DriverTask) => void;
  onRecheck: () => Promise<unknown>;
}) {
  const length = task.verification.codeLength;
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const [feedback, setFeedback] = useState<Feedback | null>(
    task.verification.blockedReason === "rate_limited"
      ? { kind: "rate_limited", lockedUntil: task.verification.lockedUntil }
      : null,
  );
  const [shakeKey, setShakeKey] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const keys = useRef(new Map<string, string>());
  const submit = useSubmitDeliveryCode(task.id);
  const [rechecking, setRechecking] = useState(false);

  const code = digits.join("");
  const complete = code.length === length;
  const locked = feedback?.kind === "rate_limited";
  const busy = submit.isPending || rechecking;

  useEffect(() => {
    if (!locked) refs.current[0]?.focus();
  }, [locked]);

  // After an invalid attempt the slots are cleared and re-enabled; put the cursor back for a quick retry.
  useEffect(() => {
    if (shakeKey && !busy) refs.current[0]?.focus();
  }, [shakeKey, busy]);

  const setDigit = (index: number, raw: string) => {
    const clean = toAsciiDigits(raw).replace(/\D/g, "");
    if (feedback && feedback.kind !== "rate_limited") setFeedback(null);
    setDigits((prev) => {
      const next = [...prev];
      if (clean.length > 1) {
        clean
          .slice(0, length - index)
          .split("")
          .forEach((d, i) => (next[index + i] = d));
        refs.current[Math.min(index + clean.length, length - 1)]?.focus();
      } else {
        next[index] = clean;
        if (clean && index < length - 1) refs.current[index + 1]?.focus();
      }
      return next;
    });
  };

  const onSubmit = async () => {
    if (!complete || busy || locked) return;
    // Same code → same key, so a retry after a timeout can't create a second verification.
    const idempotencyKey = keys.current.get(code) ?? createId("vk");
    keys.current.set(code, idempotencyKey);
    try {
      const result = await submit.mutateAsync({ code, idempotencyKey });
      if (result.ok) {
        onValid(result.task);
        return;
      }
      if (result.outcome === "invalid") {
        setFeedback({ kind: "invalid", attemptsRemaining: result.attemptsRemaining });
        setDigits(Array(length).fill(""));
        setShakeKey((k) => k + 1);
      } else if (result.outcome === "rate_limited") {
        setFeedback({ kind: "rate_limited", lockedUntil: result.lockedUntil });
        setDigits(Array(length).fill(""));
      } else {
        setFeedback({ kind: "closed", outcome: result.outcome });
      }
    } catch (err) {
      setFeedback(err instanceof NetworkError && err.kind === "offline" ? { kind: "offline" } : { kind: "unknown" });
    }
  };

  const recheck = async () => {
    setRechecking(true);
    try {
      const res = (await onRecheck()) as { data?: DriverTask | null };
      if (res.data?.status === "awaiting_confirmation") onValid(res.data);
      else setFeedback(null);
    } finally {
      setRechecking(false);
    }
  };

  return (
    <>
      <BackHeader title="ثبت کد تحویل" />
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-6 pb-4">
        <div className="text-center">
          <div className="text-[20px] font-extrabold">{task.shop.name}</div>
          <div className="mt-0.5 text-[14px] text-label-secondary">
            سفارش <span className="ltr">{task.orderNumber}</span>، {toFaNum(task.cartons)} کارتن
          </div>
        </div>

        <p className="mt-8 mb-4 text-center text-[17px] font-semibold">کد تحویل را از مشتری دریافت کنید.</p>

        <div key={shakeKey}>
          <CodeSlots
            digits={digits}
            refs={refs}
            onDigit={setDigit}
            onBackspace={(i) => {
              setDigits((prev) => {
                const next = [...prev];
                next[i - 1] = "";
                return next;
              });
              refs.current[i - 1]?.focus();
            }}
            error={feedback?.kind === "invalid"}
            disabled={busy || locked}
          />
        </div>

        <div className="mt-4 min-h-20" aria-live="polite">
          {submit.isPending ? (
            <p className="text-center text-[14px] text-label-secondary">در حال بررسی کد با سرور…</p>
          ) : feedback ? (
            <FeedbackBox feedback={feedback} taskId={task.id} onRecheck={recheck} rechecking={rechecking} />
          ) : task.verification.attemptsRemaining <= 3 ? (
            <p className="text-center text-[13px] text-label-secondary">
              {toFaNum(task.verification.attemptsRemaining)} تلاش دیگر باقی مانده است.
            </p>
          ) : (
            <p className="text-center text-[13px] leading-6 text-label-secondary">
              کد را بعد از تحویل کالا از فروشگاه‌دار بگیرید. درستی کد فقط توسط سرور بررسی می‌شود.
            </p>
          )}
        </div>

        <div className="min-h-6 flex-1" />
      </div>
      <div className="shrink-0 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button onClick={() => void onSubmit()} disabled={!complete || locked} loading={submit.isPending}>
          {submit.isPending ? "در حال بررسی…" : "ثبت کد تحویل"}
        </Button>
      </div>
    </>
  );
}

function FeedbackBox({
  feedback,
  taskId,
  onRecheck,
  rechecking,
}: {
  feedback: Feedback;
  taskId: string;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const box = "flex items-start gap-2.5 rounded-xl p-3.5 text-[14px] leading-6";
  switch (feedback.kind) {
    case "invalid":
      return (
        <div role="alert" className={`${box} bg-error/10 text-error`}>
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <div className="font-bold">کد تحویل صحیح نیست.</div>
            <div>
              کد را دوباره از مشتری بپرسید.
              {feedback.attemptsRemaining != null
                ? ` ${toFaNum(feedback.attemptsRemaining)} تلاش دیگر باقی مانده است.`
                : ""}
            </div>
          </div>
        </div>
      );
    case "rate_limited":
      return (
        <div role="alert" className={`${box} bg-error/10 text-error`}>
          <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <div className="font-bold">ثبت کد موقتاً قفل شد.</div>
            <div>
              تعداد تلاش‌های ناموفق بیش از حد مجاز بود.
              {feedback.lockedUntil ? ` از ساعت ${formatTime(feedback.lockedUntil)} دوباره تلاش کنید` : ""} یا با مدیر
              شرکت پخش تماس بگیرید.
            </div>
          </div>
        </div>
      );
    case "offline":
      return (
        <div role="alert" className={`${box} bg-fill`}>
          <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <div className="font-bold">اتصال برقرار نیست؛ کد ارسال نشد.</div>
            <div className="text-label-secondary">پس از وصل شدن اینترنت دوباره «ثبت کد تحویل» را بزنید.</div>
          </div>
        </div>
      );
    case "unknown":
      return (
        <div role="alert" className={`${box} flex-col bg-fill`}>
          <div className="flex items-start gap-2.5">
            <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <div className="font-bold">پاسخی از سرور دریافت نشد.</div>
              <div className="text-label-secondary">
                ممکن است کد ثبت شده باشد. قبل از تلاش دوباره وضعیت را بررسی کنید.
              </div>
            </div>
          </div>
          <Button size="md" variant="secondary" onClick={onRecheck} loading={rechecking}>
            بررسی وضعیت
          </Button>
        </div>
      );
    case "closed":
      return (
        <div role="alert" className={`${box} flex-col bg-fill`}>
          <div>{CLOSED_COPY[feedback.outcome]}</div>
          <Link to={`/tasks/${taskId}`} className="font-semibold underline underline-offset-4">
            مشاهده وضعیت تحویل
          </Link>
        </div>
      );
  }
}

function SuccessView({ task }: { task: DriverTask }) {
  const navigate = useNavigate();
  const { data: today } = useToday();
  const next = today ? findNextStop(today.stops.filter((s) => s.id !== task.id)) : null;
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-16 pb-[max(16px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center text-center">
        <span className="result-pop flex size-24 items-center justify-center rounded-full bg-accent text-inverse">
          <CircleCheck className="size-12" strokeWidth={2} aria-hidden />
        </span>
        <h1 className="mt-6 text-[24px] font-extrabold">کد تحویل صحیح است.</h1>
        <p className="mt-2 text-[17px] leading-7">تحویل برای تأیید مدیر ثبت شد.</p>
        <div className="mt-5 flex items-center gap-2 rounded-full bg-fill px-3.5 py-2 text-[14px] font-semibold">
          <Hourglass className="size-4" aria-hidden /> در انتظار تایید مدیر
        </div>
        <div className="mt-6 w-full rounded-2xl bg-card p-4 text-right text-[14px]">
          <div className="flex justify-between">
            <span className="text-label-secondary">فروشگاه</span>
            <span className="font-semibold">{task.shop.name}</span>
          </div>
          <div className="mt-2 flex justify-between">
            <span className="text-label-secondary">سفارش</span>
            <span className="ltr font-semibold">{task.orderNumber}</span>
          </div>
          {task.submittedAt ? (
            <div className="mt-2 flex justify-between">
              <span className="text-label-secondary">زمان ثبت</span>
              <span className="font-semibold">{formatTime(task.submittedAt)}</span>
            </div>
          ) : null}
        </div>
        <p className="mt-4 text-[13px] leading-6 text-label-secondary">
          سفارش پس از تایید مدیر شرکت پخش «تحویل‌شده» می‌شود. نتیجه را در اعلان‌ها می‌بینید.
        </p>
      </div>
      <div className="min-h-8 flex-1" />
      <div className="space-y-2">
        {next ? (
          <Button onClick={() => navigate(`/tasks/${next.id}`, { replace: true })}>
            رفتن به تحویل بعدی: {next.shop.name}
          </Button>
        ) : null}
        <Button variant={next ? "secondary" : "primary"} onClick={() => navigate("/", { replace: true })}>
          بازگشت به توزیع امروز
        </Button>
      </div>
    </div>
  );
}
