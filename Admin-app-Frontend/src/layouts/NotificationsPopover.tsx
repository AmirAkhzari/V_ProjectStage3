import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, ClipboardList, ShieldCheck } from "lucide-react";
import DeliveryDecision from "@/components/delivery/DeliveryDecision";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAdminNotifications, useDeliveries, useMarkAdminNotificationsRead } from "@/features/drivers";
import { useDashboard } from "@/features/orders";
import { formatTime, relativeLabel } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import { paths } from "@/routes/paths";
import { cn } from "@/lib/utils";

export default function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const { data: notifications } = useAdminNotifications();
  const { data: awaiting } = useDeliveries({ status: "awaiting_confirmation" }, { poll: true });
  const { data: dash } = useDashboard();
  const markRead = useMarkAdminNotificationsRead();
  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;
  const pending = dash?.pendingOrders ?? 0;
  const awaitingIds = new Set(awaiting?.map((d) => d.id));
  const list = notifications?.slice(0, 6) ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="اعلان‌ها">
          <Bell />
          {unread + pending > 0 ? (
            <span className="absolute top-1 left-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white tabular-nums">
              {toFaNum(unread + pending)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-[14px] font-semibold">اعلان‌های عملیاتی</span>
          {unread ? (
            <button
              type="button"
              className="text-[12px] font-semibold text-label-secondary hover:text-foreground"
              onClick={() => markRead.mutate(undefined)}
            >
              خواندن همه
            </button>
          ) : null}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {pending ? (
            <Link
              to={`${paths.orders}?status=pending`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 border-b border-border px-4 py-3 text-[13px] hover:bg-fill"
            >
              <ClipboardList className="size-4 text-label-secondary" />
              <span className="flex-1">{toFaNum(pending)} سفارش در انتظار تایید</span>
            </Link>
          ) : null}
          {list.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-label-secondary">اعلان تحویلی ندارید.</p>
          ) : (
            list.map((n) => {
              const actionable = awaitingIds.has(n.deliveryId);
              return (
                <div
                  key={n.id}
                  className={cn("border-b border-border px-4 py-3 last:border-0", !n.readAt && "bg-fill/50")}
                >
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold">تایید کد تحویل دریافت شد</span>
                        <span className="shrink-0 text-label-tertiary">{relativeLabel(n.at)}</span>
                      </div>
                      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-label-secondary">
                        <dt>فروشگاه</dt>
                        <dd className="text-foreground">{n.retailerName}</dd>
                        <dt>سفارش</dt>
                        <dd>
                          <Link
                            to={paths.order(n.orderId)}
                            onClick={() => setOpen(false)}
                            className="ltr inline-block text-foreground hover:underline"
                          >
                            {n.orderNumber}
                          </Link>
                        </dd>
                        <dt>راننده</dt>
                        <dd className="text-foreground">{n.driverName}</dd>
                        <dt>کد تحویل</dt>
                        <dd className="text-foreground">معتبر</dd>
                        <dt>ساعت</dt>
                        <dd className="text-foreground">{formatTime(n.at)}</dd>
                      </dl>
                      {actionable ? (
                        <div className="mt-2.5">
                          <DeliveryDecision
                            size="sm"
                            delivery={{
                              id: n.deliveryId,
                              orderNumber: n.orderNumber,
                              retailerName: n.retailerName,
                              driverName: n.driverName,
                              submittedAt: n.at,
                            }}
                          />
                        </div>
                      ) : (
                        <p className="mt-1.5 text-label-tertiary">بررسی شد</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <Link
          to={paths.deliveries}
          onClick={() => setOpen(false)}
          className="block border-t border-border px-4 py-2.5 text-center text-[12px] font-semibold hover:bg-fill"
        >
          همه تاییدهای تحویل
          {awaiting?.length ? ` (${toFaNum(awaiting.length)} در انتظار)` : ""}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
