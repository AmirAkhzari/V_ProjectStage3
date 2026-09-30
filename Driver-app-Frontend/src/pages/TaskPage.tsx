import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Ban,
  Check,
  Clock,
  Hourglass,
  Info,
  KeyRound,
  Lock,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  SearchX,
  TriangleAlert,
  UserX,
} from "lucide-react";
import BackHeader from "@/components/layout/BackHeader";
import NavigateSheet from "@/components/NavigateSheet";
import QueryError from "@/components/QueryError";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import StatusPill from "@/components/ui/StatusPill";
import { useTask } from "@/features/queries";
import { BLOCKED_REASON_COPY, stopUiState, type StopUiState } from "@/lib/deliveryStatus";
import { formatJalaliDateTime, formatTime } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import { dayLabel, slotLabel } from "@/lib/dates";
import { formatPhoneDisplay } from "@/lib/phone";
import { useSessionStore } from "@/store/useSessionStore";
import type { DriverTask } from "@/types";

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading, error, refetch, isRefetching } = useTask(id);
  const [navOpen, setNavOpen] = useState(false);
  const changed = useStatusChanged(task);

  if (isLoading) {
    return (
      <>
        <BackHeader title="جزئیات تحویل" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-48" />
        </div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <BackHeader title="جزئیات تحویل" />
        <QueryError error={error} onRetry={() => void refetch()} />
      </>
    );
  }
  if (!task) {
    return (
      <>
        <BackHeader title="جزئیات تحویل" />
        <EmptyState
          icon={<SearchX />}
          title="این تحویل پیدا نشد"
          body="ممکن است این سفارش به راننده دیگری سپرده شده یا از مسیر شما حذف شده باشد."
          action={
            <Link to="/route" className="flex h-11 items-center justify-center rounded-xl bg-fill font-semibold">
              بازگشت به مسیر
            </Link>
          }
        />
      </>
    );
  }

  const state = stopUiState(task);
  const isToday = dayLabel(task.deliveryDate) === "امروز";
  const open = task.status === "assigned";

  return (
    <>
      <BackHeader
        title={`توقف ${toFaNum(task.sequence)}`}
        trailing={
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex size-11 items-center justify-center text-accent"
            aria-label="به‌روزرسانی"
          >
            <RefreshCw className={`size-5 ${isRefetching ? "animate-spin" : ""}`} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        {changed ? (
          <div role="status" className="fade-in flex items-center gap-2 bg-accent px-4 py-2.5 text-[14px] text-inverse">
            <Info className="size-4 shrink-0" aria-hidden />
            وضعیت این تحویل همین الان تغییر کرد.
          </div>
        ) : null}

        <div className="space-y-3 p-4 pb-6">
          {!isToday ? (
            <div className="flex items-center gap-2 rounded-xl bg-fill px-3.5 py-2.5 text-[13px] text-label-secondary">
              <Clock className="size-4 shrink-0" aria-hidden />
              این تحویل مربوط به {dayLabel(task.deliveryDate)} است و فقط برای مشاهده باز شده.
            </div>
          ) : null}

          <section className="rounded-2xl bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-[22px] leading-8 font-extrabold">{task.shop.name}</h1>
              <StatusPill state={state} />
            </div>
            <div className="mt-2 flex items-start gap-2 text-[15px] leading-7">
              <MapPin className="mt-1.5 size-4 shrink-0 text-label-secondary" aria-hidden />
              <span>
                {task.shop.city}، {task.shop.address}
              </span>
            </div>
            <div className="mt-1 text-[14px] text-label-secondary">
              {dayLabel(task.deliveryDate)}، ساعت {slotLabel(task.deliverySlot)}
            </div>
            {open ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button size="md" variant="secondary" onClick={() => setNavOpen(true)}>
                  <Navigation /> مسیریابی
                </Button>
                <a
                  href={`tel:${task.shop.phone}`}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-fill text-[15px] font-semibold"
                >
                  <Phone className="size-5" /> تماس
                </a>
              </div>
            ) : null}
            <NavigateSheet shop={task.shop} open={navOpen} onClose={() => setNavOpen(false)} />
          </section>

          {task.instructions && open ? (
            <section className="flex gap-3 rounded-2xl bg-card p-4">
              <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <div className="text-[14px] font-semibold">توضیحات تحویل</div>
                <p className="mt-0.5 text-[14px] leading-6 text-label-secondary">{task.instructions}</p>
              </div>
            </section>
          ) : null}

          <VerificationPanel task={task} state={state} />

          <section className="rounded-2xl bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">خلاصه سفارش</h2>
              <span className="ltr text-[14px] font-semibold text-label-secondary">{task.orderNumber}</span>
            </div>
            <ul className="divide-y divide-separator">
              {task.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                  <span className="min-w-0 flex-1 leading-6">{item.name}</span>
                  <span className="shrink-0 font-semibold">{toFaNum(item.qty)} کارتن</span>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex justify-between border-t border-separator pt-3 text-[15px] font-bold">
              <span>جمع</span>
              <span>
                {toFaNum(task.itemsCount)} قلم، {toFaNum(task.cartons)} کارتن
              </span>
            </div>
          </section>

          <section className="rounded-2xl bg-card p-4 text-[14px]">
            <div className="flex items-center justify-between">
              <span className="text-label-secondary">تلفن فروشگاه</span>
              <a href={`tel:${task.shop.phone}`} className="ltr font-semibold">
                {formatPhoneDisplay(task.shop.phone)}
              </a>
            </div>
          </section>
        </div>
      </div>

      {task.verification.canSubmitCode ? (
        <div className="shrink-0 border-t border-separator bg-card/90 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-xl">
          <p className="mb-2 text-center text-[13px] text-label-secondary">کد تحویل را از مشتری دریافت کنید.</p>
          <Link
            to={`/tasks/${task.id}/code`}
            className="flex h-[56px] items-center justify-center gap-2 rounded-[14px] bg-accent text-[17px] font-bold text-inverse"
          >
            <KeyRound className="size-5" aria-hidden /> ثبت کد تحویل
          </Link>
        </div>
      ) : null}
    </>
  );
}

function VerificationPanel({ task, state }: { task: DriverTask; state: StopUiState }) {
  const distributorPhone = useSessionStore((s) => s.session?.driver.distributorPhone);
  const reason = task.verification.blockedReason;
  if (!reason) return null;

  const copy = BLOCKED_REASON_COPY[reason];
  const icon =
    reason === "awaiting_confirmation" ? (
      <Hourglass />
    ) : reason === "confirmed" ? (
      <Check />
    ) : reason === "rejected" ? (
      <TriangleAlert />
    ) : reason === "rate_limited" ? (
      <Lock />
    ) : reason === "not_dispatched" ? (
      <Clock />
    ) : state === "reassigned" ? (
      <UserX />
    ) : (
      <Ban />
    );

  const title =
    reason === "cancelled"
      ? state === "reassigned"
        ? "این سفارش از مسیر شما حذف شد"
        : "این سفارش لغو شد"
      : copy.title;
  const danger = reason === "rejected" || reason === "rate_limited";

  return (
    <section
      aria-label="وضعیت تحویل"
      className={`rounded-2xl p-4 ${reason === "awaiting_confirmation" ? "bg-accent text-inverse" : "bg-card"}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5 ${
            reason === "awaiting_confirmation" ? "bg-inverse/15" : danger ? "bg-error/12 text-error" : "bg-fill"
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-bold">{title}</div>
          <p
            className={`mt-0.5 text-[14px] leading-6 ${reason === "awaiting_confirmation" ? "opacity-80" : "text-label-secondary"}`}
          >
            {reason === "cancelled" && state === "reassigned"
              ? "این سفارش به راننده دیگری سپرده شد. نیازی به تحویل آن نیست."
              : reason === "rate_limited" && task.verification.lockedUntil
                ? `تعداد تلاش‌های ناموفق بیش از حد مجاز بود. از ساعت ${formatTime(task.verification.lockedUntil)} می‌توانید دوباره تلاش کنید.`
                : copy.body}
          </p>
          {task.rejectionReason && reason === "rejected" ? (
            <p className="mt-2 rounded-xl bg-fill p-3 text-[14px] leading-6">
              <span className="font-semibold">دلیل: </span>
              {task.rejectionReason}
            </p>
          ) : null}
          <dl className="mt-2 space-y-0.5 text-[13px] opacity-80">
            {task.submittedAt ? (
              <div className="flex gap-1">
                <dt>ثبت کد:</dt>
                <dd>{formatJalaliDateTime(task.submittedAt)}</dd>
              </div>
            ) : null}
            {task.confirmedAt ? (
              <div className="flex gap-1">
                <dt>تایید مدیر:</dt>
                <dd>{formatJalaliDateTime(task.confirmedAt)}</dd>
              </div>
            ) : null}
            {task.rejectedAt ? (
              <div className="flex gap-1">
                <dt>رد مدیر:</dt>
                <dd>{formatJalaliDateTime(task.rejectedAt)}</dd>
              </div>
            ) : null}
          </dl>
          {(reason === "rejected" || reason === "rate_limited") && distributorPhone ? (
            <a
              href={`tel:${distributorPhone}`}
              className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-fill text-[15px] font-semibold text-foreground"
            >
              <Phone className="size-4" /> تماس با شرکت پخش
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** True for a few seconds after a poll delivers a different status than the one on screen. */
function useStatusChanged(task: DriverTask | null | undefined) {
  const prev = useRef<string | null>(null);
  const [changed, setChanged] = useState(false);
  const signature = task ? `${task.id}:${task.status}:${task.orderStatus}` : null;
  useEffect(() => {
    if (!signature) return;
    const [id] = signature.split(":");
    if (prev.current && prev.current.startsWith(`${id}:`) && prev.current !== signature) {
      setChanged(true);
      const t = setTimeout(() => setChanged(false), 6000);
      prev.current = signature;
      return () => clearTimeout(t);
    }
    prev.current = signature;
  }, [signature]);
  return changed;
}
