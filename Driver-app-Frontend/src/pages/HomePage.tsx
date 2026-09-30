import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Hourglass, MapPin, Navigation, PackageCheck, Phone, Truck } from "lucide-react";
import LargeHeader from "@/components/layout/LargeHeader";
import NotificationBell from "@/components/NotificationBell";
import NavigateSheet from "@/components/NavigateSheet";
import QueryError from "@/components/QueryError";
import StopRow from "@/components/StopRow";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useNotifications, useToday } from "@/features/queries";
import { findNextStop, stopUiState } from "@/lib/deliveryStatus";
import { formatJalali } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import { slotLabel } from "@/lib/dates";
import { useSessionStore } from "@/store/useSessionStore";

export default function HomePage() {
  const driver = useSessionStore((s) => s.session?.driver);
  const { data, isLoading, error, refetch } = useToday();
  const { data: notifications } = useNotifications();
  const [navOpen, setNavOpen] = useState(false);

  const firstName = driver?.name.split(" ")[0] ?? "";
  const next = data ? findNextStop(data.stops) : null;
  const unread = notifications?.filter((n) => !n.readAt).slice(0, 2) ?? [];
  const preview = data?.stops.filter((s) => s.status !== "cancelled").slice(0, 5) ?? [];

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <LargeHeader
        subtitle={formatJalali(new Date(), { withWeekday: true, withYear: false })}
        title={`سلام، ${firstName}`}
        trailing={<NotificationBell />}
      />

      {isLoading ? (
        <div className="space-y-3 px-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-52" />
          <Skeleton className="h-40" />
        </div>
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : !data || data.stats.total === 0 ? (
        <EmptyState
          icon={<Truck />}
          title="امروز توزیعی به شما تخصیص داده نشده"
          body="وقتی مدیر شرکت پخش سفارشی به مسیر شما اضافه کند، اینجا نمایش داده می‌شود و اعلان دریافت می‌کنید."
        />
      ) : (
        <div className="space-y-4 px-4">
          <section aria-label="خلاصه امروز" className="rounded-2xl bg-card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">توزیع امروز</span>
              <span className="text-[13px] text-label-secondary">{toFaNum(data.stats.total)} سفارش</span>
            </div>
            <Progress stats={data.stats} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="تحویل‌شده" value={data.stats.confirmed} />
              <Stat label="منتظر تایید" value={data.stats.awaiting} />
              <Stat label="باقیمانده" value={data.stats.remaining} strong />
            </dl>
          </section>

          {unread.length ? (
            <section aria-label="اعلان‌های مهم" className="space-y-2">
              {unread.map((n) => (
                <Link
                  key={n.id}
                  to={n.deliveryId ? `/tasks/${n.deliveryId}` : "/notifications"}
                  className="flex items-start gap-3 rounded-2xl bg-card p-3.5"
                >
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-error" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{n.title}</span>
                    <span className="line-clamp-2 block text-[13px] leading-5 text-label-secondary">{n.body}</span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {next ? (
            <section aria-label="تحویل بعدی" className="rounded-2xl bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-label-secondary">
                  تحویل بعدی، توقف {toFaNum(next.sequence)}
                </span>
                <span className="ltr text-[13px] font-semibold text-label-secondary">{next.orderNumber}</span>
              </div>
              <div className="text-[22px] leading-8 font-extrabold">{next.shop.name}</div>
              <div className="mt-2 flex items-start gap-2 text-[14px] leading-6 text-label-secondary">
                <MapPin className="mt-1 size-4 shrink-0" aria-hidden />
                <span>
                  {next.shop.city}، {next.shop.address}
                </span>
              </div>
              <div className="mt-1 text-[14px] text-label-secondary">
                ساعت {slotLabel(next.deliverySlot)}، {toFaNum(next.itemsCount)} قلم، {toFaNum(next.cartons)} کارتن
              </div>
              {next.orderStatus !== "shipped" ? (
                <div className="mt-3 rounded-xl bg-fill p-3 text-[13px] leading-6 text-label-secondary">
                  این سفارش هنوز از انبار ارسال نشده است.
                </div>
              ) : null}
              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                <Button onClick={() => setNavOpen(true)}>
                  <Navigation /> مسیریابی
                </Button>
                <a
                  href={`tel:${next.shop.phone}`}
                  aria-label="تماس با فروشگاه"
                  className="flex size-[54px] items-center justify-center rounded-[14px] bg-fill"
                >
                  <Phone className="size-5" />
                </a>
              </div>
              <Link
                to={`/tasks/${next.id}`}
                className="mt-2 flex h-[54px] items-center justify-center gap-2 rounded-[14px] bg-fill text-[17px] font-semibold"
              >
                باز کردن تحویل
              </Link>
              <NavigateSheet shop={next.shop} open={navOpen} onClose={() => setNavOpen(false)} />
            </section>
          ) : (
            <section className="rounded-2xl bg-card">
              <EmptyState
                className="py-8"
                icon={data.stats.awaiting ? <Hourglass /> : <PackageCheck />}
                title={data.stats.awaiting ? "همه کدهای تحویل ثبت شد" : "توزیع امروز تمام شد"}
                body={
                  data.stats.awaiting
                    ? `${toFaNum(data.stats.awaiting)} تحویل در انتظار تایید مدیر است. نیازی به اقدام شما نیست.`
                    : "همه تحویل‌های امروز توسط مدیر تایید شد. خسته نباشید!"
                }
              />
            </section>
          )}

          <section aria-label="مسیر امروز">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[17px] font-bold">مسیر امروز</h2>
              <Link to="/route" className="flex min-h-11 items-center gap-0.5 text-[14px] font-semibold">
                همه توقف‌ها <ChevronLeft className="size-4" />
              </Link>
            </div>
            {preview.map((s, i) => (
              <StopRow key={s.id} stop={s} state={stopUiState(s, next?.id)} timeline last={i === preview.length - 1} />
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function Progress({ stats }: { stats: { total: number; confirmed: number; awaiting: number } }) {
  const pct = (n: number) => (stats.total ? (n / stats.total) * 100 : 0);
  return (
    <div
      className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-fill"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={stats.total}
      aria-valuenow={stats.confirmed + stats.awaiting}
      aria-label="پیشرفت توزیع"
    >
      <span className="h-full bg-accent" style={{ width: `${pct(stats.confirmed)}%` }} />
      <span className="h-full bg-label-tertiary" style={{ width: `${pct(stats.awaiting)}%` }} />
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-xl py-2.5 ${strong ? "bg-accent text-inverse" : "bg-fill"}`}>
      <dd className="text-[24px] leading-8 font-extrabold">{toFaNum(value)}</dd>
      <dt className={`text-[12px] font-medium ${strong ? "opacity-75" : "text-label-secondary"}`}>{label}</dt>
    </div>
  );
}
