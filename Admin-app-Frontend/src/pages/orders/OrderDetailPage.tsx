import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CreditCard,
  FlaskConical,
  Hourglass,
  MapPin,
  MoreHorizontal,
  Phone,
  ShieldCheck,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import OrderStatusBadge, { PaymentStatusBadge } from "@/components/shared/StatusBadge";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import Can from "@/components/shared/Can";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrder, useUpdateOrderStatus } from "@/features/orders";
import { canCancel, NEXT_ACTION_LABELS, nextStatus, ORDER_STATUS_LABELS } from "@/lib/orderStatus";
import { formatJalali, formatJalaliDateTime, formatJalaliShort } from "@/lib/jalali";
import { toFaDigits, toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { paths } from "@/routes/paths";
import OrderTimeline from "./components/OrderTimeline";
import DriverSelect from "@/components/delivery/DriverSelect";
import DeliveryDecision from "@/components/delivery/DeliveryDecision";
import DeliveryStatusBadge from "@/components/shared/DeliveryStatusBadge";
import { useDeliveries, useDrivers, useSimulateVerification } from "@/features/drivers";
import { isActiveDelivery } from "@/lib/deliveryStatus";
import { cn } from "@/lib/utils";

const isMock = import.meta.env.VITE_API_MODE !== "http";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const mutation = useUpdateOrderStatus(id ?? "");
  const { data: drivers } = useDrivers();
  const { data: deliveries } = useDeliveries(id ? { orderId: id } : undefined);
  const simulate = useSimulateVerification();
  const [confirm, setConfirm] = useState<null | "next" | "cancel">(null);

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }
  if (!order) {
    return (
      <EmptyState
        title="سفارش پیدا نشد"
        description="ممکن است این سفارش متعلق به شرکت پخش دیگری باشد."
        className="py-32"
        action={
          <Button asChild variant="secondary">
            <Link to={paths.orders}>بازگشت به سفارش‌ها</Link>
          </Button>
        }
      />
    );
  }

  const driverBound = isActiveDelivery(order.delivery);
  const rawNext = nextStatus(order.status);
  // With a driver on the order, "delivered" only comes from confirming the driver's verified code.
  const next = rawNext === "delivered" && driverBound ? null : rawNext;
  const cartons = order.items.reduce((s, i) => s + i.qty, 0);
  const deliveryHistory = (deliveries ?? []).filter((d) => d.id !== order.delivery?.id);
  const current = (deliveries ?? []).find((d) => d.id === order.delivery?.id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "سفارش‌ها", to: paths.orders }, { label: order.number }]}
        title={<span className="ltr inline-block">{order.number}</span>}
        badge={<OrderStatusBadge status={order.status} />}
        description={`ثبت‌شده در ${formatJalaliDateTime(order.createdAt)} · ${toFaNum(order.items.length)} قلم · ${toFaNum(cartons)} کارتن`}
        actions={
          <>
            <Can perm="orders.update">
              {next ? (
                <Button onClick={() => setConfirm("next")} loading={mutation.isPending && confirm === "next"}>
                  <ArrowLeft className="order-last" />
                  {NEXT_ACTION_LABELS[next]}
                </Button>
              ) : null}
            </Can>
            {order.delivery?.status === "awaiting_confirmation" && current ? (
              <DeliveryDecision delivery={current} />
            ) : rawNext === "delivered" && driverBound ? (
              <Badge variant="outline" className="h-9 px-3">
                <Hourglass className="size-3.5" /> منتظر کد تحویل راننده
              </Badge>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="بیشتر">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={paths.retailer(order.retailerId)}>مشاهده فروشگاه</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={paths.distributor(order.distributorId)}>مشاهده شرکت پخش</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.print()}>چاپ فاکتور</DropdownMenuItem>
                {isMock && order.delivery?.status === "assigned" && order.status === "shipped" ? (
                  <DropdownMenuItem onSelect={() => simulate.mutate(order.delivery!.id)}>
                    <FlaskConical /> شبیه‌سازی ثبت کد معتبر توسط راننده
                  </DropdownMenuItem>
                ) : null}
                <Can perm="orders.cancel">
                  <DropdownMenuItem
                    destructive
                    disabled={!canCancel(order.status)}
                    onSelect={() => setConfirm("cancel")}
                  >
                    <Ban /> لغو سفارش
                  </DropdownMenuItem>
                </Can>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>اقلام سفارش</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>کالا</TableHead>
                  <TableHead>تعداد</TableHead>
                  <TableHead>قیمت کارتن</TableHead>
                  <TableHead>جمع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img src={item.img} alt="" className="size-11 shrink-0 rounded-lg bg-fill object-cover" />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium">{item.name}</div>
                          <div className="text-[12px] text-label-secondary">
                            × {toFaNum(item.unitsPerCarton)} عدد / کارتن
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{toFaNum(item.qty)} کارتن</TableCell>
                    <TableCell>
                      <Price value={item.price} />
                    </TableCell>
                    <TableCell className="font-semibold">
                      <Price value={item.price * item.qty} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CardContent className="mt-2 border-t border-border pt-4">
              <dl className="ml-auto grid max-w-xs gap-2 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-label-secondary">جمع اقلام</dt>
                  <dd>
                    <Price value={order.subtotal} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-label-secondary">
                    تخفیف{" "}
                    {order.couponCode ? (
                      <span className="ltr inline-block text-[11px]">({order.couponCode})</span>
                    ) : null}
                  </dt>
                  <dd>
                    <Price value={-order.discount} signed />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-label-secondary">هزینه ارسال</dt>
                  <dd>{order.deliveryFee ? <Price value={order.deliveryFee} /> : "رایگان"}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
                  <dt>قابل پرداخت</dt>
                  <dd>
                    <Price value={order.total} />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>تاریخچه وضعیت</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTimeline events={order.events} current={order.status} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="size-4 text-label-secondary" /> فروشگاه
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to={paths.retailer(order.retailerId)}>پروفایل</Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-2 text-[13px]">
              <div className="font-semibold">{order.retailerName}</div>
              <a
                href={`tel:${order.retailerPhone}`}
                className="flex items-center gap-2 text-label-secondary hover:text-foreground"
              >
                <Phone className="size-3.5" /> <span className="ltr">{formatPhoneDisplay(order.retailerPhone)}</span>
              </a>
              <div className="flex items-start gap-2 text-label-secondary">
                <MapPin className="mt-0.5 size-3.5 shrink-0" /> <span>{order.addressLabel}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4 text-label-secondary" /> تحویل
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-[13px]">
              <div className="grid gap-1.5 pb-2">
                <span className="text-label-secondary">راننده</span>
                <DriverSelect order={order} drivers={drivers ?? []} size="md" />
              </div>
              {order.delivery ? (
                <div
                  className={cn(
                    "mb-2 grid gap-1.5 rounded-xl p-3",
                    order.delivery.status === "awaiting_confirmation"
                      ? "bg-primary text-primary-foreground"
                      : "bg-fill",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {order.delivery.status === "awaiting_confirmation" ? (
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="size-4" /> کد تحویل معتبر ثبت شد
                        </span>
                      ) : (
                        <>
                          توقف {toFaNum(order.delivery.sequence)} مسیر {order.delivery.driverName}
                        </>
                      )}
                    </span>
                    {order.delivery.status === "awaiting_confirmation" ? null : (
                      <DeliveryStatusBadge status={order.delivery.status} closedReason={current?.closedReason} />
                    )}
                  </div>
                  {order.delivery.submittedAt ? (
                    <div className="flex justify-between opacity-80">
                      <span>ثبت کد توسط {order.delivery.driverName}</span>
                      <span>{formatJalaliDateTime(order.delivery.submittedAt)}</span>
                    </div>
                  ) : null}
                  {current?.confirmedAt ? (
                    <div className="flex justify-between opacity-80">
                      <span>تایید: {current.confirmedByName}</span>
                      <span>{formatJalaliDateTime(current.confirmedAt)}</span>
                    </div>
                  ) : null}
                  {current?.rejectedAt ? (
                    <div className="text-destructive">
                      رد توسط {current.rejectedByName}: {current.rejectionReason}
                    </div>
                  ) : null}
                  {order.delivery.status === "rejected" ? (
                    <p className="text-[12px] opacity-80">
                      برای ادامه، سفارش را دوباره به همین یا راننده دیگری بسپارید.
                    </p>
                  ) : null}
                  {current?.failedAttempts ? (
                    <p className="text-[12px] opacity-80">{toFaNum(current.failedAttempts)} تلاش ناموفق ثبت کد</p>
                  ) : null}
                </div>
              ) : null}
              {deliveryHistory.length ? (
                <details className="mb-1 text-[12px] text-label-secondary">
                  <summary className="cursor-pointer">سابقه تخصیص ({toFaNum(deliveryHistory.length)})</summary>
                  <ul className="mt-1.5 grid gap-1">
                    {deliveryHistory.map((d) => (
                      <li key={d.id} className="flex justify-between gap-2">
                        <span>{d.driverName}</span>
                        <DeliveryStatusBadge status={d.status} closedReason={d.closedReason} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="flex justify-between">
                <span className="text-label-secondary">شرکت پخش</span>
                <Link to={paths.distributor(order.distributorId)} className="font-medium hover:underline">
                  {order.distributorName}
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-label-secondary">تاریخ</span>
                <span>
                  {formatJalali(order.deliveryDate, {
                    withWeekday: true,
                    withYear: false,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-label-secondary">ساعت</span>
                <span className="tabular-nums">{toFaDigits(order.deliverySlot)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="size-4 text-label-secondary" /> پرداخت
              </CardTitle>
              <PaymentStatusBadge status={order.paymentStatus} />
            </CardHeader>
            <CardContent className="grid gap-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-label-secondary">روش</span>
                <span className="flex items-center gap-1.5">
                  {order.paymentMethod === "wallet" ? (
                    <Wallet className="size-3.5" />
                  ) : (
                    <CreditCard className="size-3.5" />
                  )}
                  {order.paymentMethod === "wallet" ? "کیف پول" : "درگاه بانکی"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-label-secondary">مبلغ</span>
                <Price value={order.total} className="font-semibold" />
              </div>
              {order.cancelReason ? (
                <div className="mt-1 rounded-lg bg-destructive/8 p-2.5 text-[12px] text-destructive">
                  <span className="font-semibold">دلیل لغو:</span> {order.cancelReason}
                </div>
              ) : null}
            </CardContent>
          </Card>
          {order.couponCode ? (
            <div className="flex items-center justify-between rounded-[10px] bg-card px-5 py-3 text-[13px]">
              <span className="text-label-secondary">کد تخفیف</span>
              <Badge variant="outline" className="ltr">
                {order.couponCode}
              </Badge>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "next"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={next ? (NEXT_ACTION_LABELS[next] ?? "") : ""}
        description={
          next ? (
            <>
              وضعیت سفارش <span className="ltr inline-block font-semibold text-foreground">{order.number}</span> از «
              {ORDER_STATUS_LABELS[order.status]}» به «{ORDER_STATUS_LABELS[next]}» تغییر می‌کند و به فروشگاه اطلاع داده
              می‌شود. تحویل: {formatJalaliShort(order.deliveryDate)}.
            </>
          ) : null
        }
        confirmLabel={next ? NEXT_ACTION_LABELS[next] : "تایید"}
        loading={mutation.isPending}
        onConfirm={async () => {
          if (!next) return;
          await mutation.mutateAsync({ status: next });
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="لغو سفارش"
        description="این عملیات قابل بازگشت نیست. مبلغ سفارش به کیف پول فروشگاه بازگردانده می‌شود."
        confirmLabel="لغو سفارش"
        destructive
        requireReason
        reasonLabel="دلیل لغو (برای فروشگاه نمایش داده می‌شود)"
        loading={mutation.isPending}
        onConfirm={async (reason) => {
          await mutation.mutateAsync({ status: "cancelled", note: reason });
          setConfirm(null);
        }}
      />
    </>
  );
}
