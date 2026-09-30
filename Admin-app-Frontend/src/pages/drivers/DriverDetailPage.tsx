import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Car, KeyRound, MoreHorizontal, Pencil, Phone, Power, Send, UserRound } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import Can from "@/components/shared/Can";
import DeliveryStatusBadge from "@/components/shared/DeliveryStatusBadge";
import OrderStatusBadge, { ActiveBadge } from "@/components/shared/StatusBadge";
import DeliveryDecision from "@/components/delivery/DeliveryDecision";
import DataTable from "@/components/data-table/DataTable";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useDeliveries,
  useDispatchRoute,
  useDriver,
  useReorderRoute,
  useResetDriverPassword,
  useSetDriverActive,
} from "@/features/drivers";
import { useIsDistributorAdmin } from "@/store/useSessionStore";
import { formatJalaliShort, formatTime, relativeLabel } from "@/lib/jalali";
import { toFaDigits, toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { paths } from "@/routes/paths";
import type { Delivery } from "@/types";
import DriverFormDialog, { CredentialsView, generatePassword } from "./components/DriverFormDialog";

export default function DriverDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const isDistributor = useIsDistributorAdmin();
  const { data: driver, isLoading } = useDriver(id);
  const { data: today } = useDeliveries({ driverId: id, range: "today" }, { poll: true });
  const { data: all, isLoading: loadingAll } = useDeliveries({ driverId: id });
  const setActive = useSetDriverActive();
  const resetPassword = useResetDriverPassword();
  const reorder = useReorderRoute(id);
  const dispatch = useDispatchRoute();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "toggle" | "password">(null);
  const [newCredentials, setNewCredentials] = useState<{ username: string; password: string } | null>(null);

  const route = useMemo(() => (today ?? []).filter((d) => d.status !== "cancelled"), [today]);
  const removed = useMemo(() => (today ?? []).filter((d) => d.status === "cancelled"), [today]);
  const packingCount = route.filter((d) => d.status === "assigned" && d.orderStatus === "packing").length;

  const columns = useMemo<ColumnDef<Delivery, unknown>[]>(
    () => [
      {
        accessorKey: "deliveryDate",
        header: "تاریخ",
        cell: ({ getValue }) => <span className="whitespace-nowrap">{formatJalaliShort(getValue<string>())}</span>,
      },
      {
        accessorKey: "orderNumber",
        header: "سفارش",
        cell: ({ row }) => (
          <Link
            to={paths.order(row.original.orderId)}
            className="ltr inline-block font-semibold hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.orderNumber}
          </Link>
        ),
      },
      { accessorKey: "retailerName", header: "فروشگاه" },
      {
        accessorKey: "status",
        header: "وضعیت تحویل",
        enableSorting: false,
        cell: ({ row }) => (
          <DeliveryStatusBadge status={row.original.status} closedReason={row.original.closedReason} />
        ),
      },
      {
        accessorKey: "submittedAt",
        header: "ثبت کد",
        cell: ({ getValue }) => (
          <span className="text-label-secondary">
            {getValue<string | null>() ? formatTime(getValue<string>()) : "—"}
          </span>
        ),
      },
      {
        id: "decision",
        header: "تایید / رد",
        accessorFn: (d) => d.confirmedAt ?? d.rejectedAt ?? "",
        cell: ({ row }) => {
          const d = row.original;
          if (d.confirmedAt)
            return (
              <span className="text-[12px] text-label-secondary">
                {d.confirmedByName}، {formatTime(d.confirmedAt)}
              </span>
            );
          if (d.rejectedAt)
            return (
              <span className="text-[12px] text-destructive" title={d.rejectionReason ?? undefined}>
                رد: {d.rejectedByName}، {formatTime(d.rejectedAt)}
              </span>
            );
          return <span className="text-label-tertiary">—</span>;
        },
      },
    ],
    [],
  );

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
  if (!driver) {
    return (
      <EmptyState
        title="راننده پیدا نشد"
        description="ممکن است این راننده متعلق به شرکت پخش دیگری باشد."
        className="py-32"
        action={
          <Button asChild variant="secondary">
            <Link to={paths.drivers}>بازگشت به رانندگان</Link>
          </Button>
        }
      />
    );
  }

  const move = (deliveryId: string, dir: -1 | 1) => {
    const ids = route.map((d) => d.id);
    const i = ids.indexOf(deliveryId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "رانندگان", to: paths.drivers }, { label: driver.name }]}
        title={driver.name}
        badge={<ActiveBadge active={driver.active} />}
        description={
          <>
            <span className="ltr inline-block">{driver.username}</span>
            {isDistributor ? null : `، ${driver.distributorName}`}
            {driver.lastLoginAt ? `، آخرین ورود ${relativeLabel(driver.lastLoginAt)}` : ""}
          </>
        }
        actions={
          <Can perm="drivers.manage">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> ویرایش
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="بیشتر">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setConfirm("password")}>
                  <KeyRound /> بازنشانی رمز عبور
                </DropdownMenuItem>
                <DropdownMenuItem destructive={driver.active} onSelect={() => setConfirm("toggle")}>
                  <Power /> {driver.active ? "غیرفعال کردن حساب" : "فعال کردن حساب"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Can>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                مسیر امروز
                <span className="mr-2 text-[12px] font-normal text-label-secondary">
                  {toFaNum(driver.today.confirmed)} تحویل‌شده، {toFaNum(driver.today.awaiting)} منتظر تایید،{" "}
                  {toFaNum(driver.today.remaining)} باقیمانده
                </span>
              </CardTitle>
              <Can perm="orders.update">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!packingCount}
                  loading={dispatch.isPending}
                  onClick={() => dispatch.mutate(driver.id)}
                  title="سفارش‌های «در حال بسته‌بندی» این مسیر «ارسال شده» می‌شوند"
                >
                  <Send /> ثبت ارسال {packingCount ? `${toFaNum(packingCount)} سفارش آماده` : ""}
                </Button>
              </Can>
            </CardHeader>
            <CardContent>
              {route.length === 0 ? (
                <EmptyState
                  title="امروز سفارشی به این راننده سپرده نشده"
                  description="از صفحه سفارش‌ها، ستون «راننده» را برای سفارش‌های تاییدشده انتخاب کنید."
                  action={
                    <Button asChild variant="secondary" size="sm">
                      <Link to={paths.orders}>رفتن به سفارش‌ها</Link>
                    </Button>
                  }
                />
              ) : (
                <ol className="divide-y divide-border">
                  {route.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill text-[13px] font-bold">
                        {toFaNum(d.sequence)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="font-semibold">{d.retailerName}</span>
                          <Link to={paths.order(d.orderId)} className="ltr text-label-secondary hover:underline">
                            {d.orderNumber}
                          </Link>
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-label-secondary">
                          {d.city}، ساعت {toFaDigits(d.deliverySlot)}، {toFaNum(d.cartons)} کارتن
                          {d.failedAttempts ? `، ${toFaNum(d.failedAttempts)} تلاش ناموفق کد` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <OrderStatusBadge status={d.orderStatus} />
                        <DeliveryStatusBadge status={d.status} />
                      </div>
                      {d.status === "awaiting_confirmation" ? (
                        <DeliveryDecision delivery={d} size="sm" />
                      ) : d.status === "assigned" ? (
                        <Can perm="deliveries.assign">
                          <div className="flex gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="جلوتر در مسیر"
                              disabled={reorder.isPending || route[0]?.id === d.id}
                              onClick={() => move(d.id, -1)}
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="عقب‌تر در مسیر"
                              disabled={reorder.isPending || route.at(-1)?.id === d.id}
                              onClick={() => move(d.id, 1)}
                            >
                              <ArrowDown />
                            </Button>
                          </div>
                        </Can>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {removed.length ? (
                <p className="mt-3 border-t border-border pt-3 text-[12px] text-label-secondary">
                  حذف‌شده از مسیر امروز: {removed.map((d) => d.orderNumber).join("، ")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>فعالیت تحویل</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={all ?? []}
                loading={loadingAll}
                pageSize={8}
                emptyTitle="هنوز فعالیتی ثبت نشده"
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="size-4 text-label-secondary" /> مشخصات
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-[13px]">
              <div className="flex items-center gap-3">
                <Avatar name={driver.name} />
                <div>
                  <div className="font-semibold">{driver.name}</div>
                  <div className="text-[12px] text-label-secondary">{driver.distributorName}</div>
                </div>
              </div>
              <Row label="شناسه راننده" value={<span className="ltr font-mono">{driver.username}</span>} />
              <Row
                label="موبایل"
                value={
                  <a href={`tel:${driver.phone}`} className="ltr flex items-center gap-1.5 hover:underline">
                    <Phone className="size-3" /> {formatPhoneDisplay(driver.phone)}
                  </a>
                }
              />
              <Row label="عضویت" value={formatJalaliShort(driver.createdAt)} />
              <Row label="آخرین تغییر رمز" value={relativeLabel(driver.passwordUpdatedAt)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="size-4 text-label-secondary" /> خودرو
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-[13px]">
              {driver.vehicle ? (
                <>
                  <Row label="نوع" value={driver.vehicle.type} />
                  <Row label="پلاک" value={driver.vehicle.plate || "—"} />
                </>
              ) : (
                <span className="text-label-secondary">اطلاعات خودرو ثبت نشده است.</span>
              )}
            </CardContent>
          </Card>
          <div className="rounded-[10px] bg-card p-4 text-[12px] leading-6 text-label-secondary">
            راننده فقط سفارش‌های سپرده‌شده به خودش را می‌بیند و کد تحویل را ثبت می‌کند. سفارش پس از تایید شما «تحویل
            شده» می‌شود. موقعیت زنده (GPS) ثبت نمی‌شود.
          </div>
        </div>
      </div>

      <DriverFormDialog open={editing} onOpenChange={setEditing} driver={driver} />
      <ConfirmDialog
        open={confirm === "toggle"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={driver.active ? "غیرفعال کردن راننده" : "فعال کردن راننده"}
        description={
          driver.active
            ? "راننده دیگر نمی‌تواند وارد شود، نشست‌های فعالش باطل می‌شود و در فهرست تعیین راننده نمایش داده نمی‌شود. سفارش‌های باز او را به راننده دیگری بسپارید."
            : "راننده می‌تواند دوباره وارد شود و سفارش بگیرد."
        }
        confirmLabel={driver.active ? "غیرفعال کن" : "فعال کن"}
        destructive={driver.active}
        loading={setActive.isPending}
        onConfirm={async () => {
          await setActive.mutateAsync({ id: driver.id, active: !driver.active });
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "password"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="بازنشانی رمز عبور"
        description="یک رمز تصادفی جدید ساخته می‌شود و رمز قبلی و نشست‌های فعال راننده باطل می‌شوند."
        confirmLabel="ساخت رمز جدید"
        loading={resetPassword.isPending}
        onConfirm={async () => {
          const password = generatePassword();
          const res = await resetPassword.mutateAsync({ id: driver.id, password });
          setConfirm(null);
          if (res.ok) setNewCredentials({ username: driver.username, password });
        }}
      />
      <Dialog open={Boolean(newCredentials)} onOpenChange={(v) => !v && setNewCredentials(null)}>
        <DialogContent className="max-w-md">
          {newCredentials ? (
            <CredentialsView
              title="رمز جدید ساخته شد"
              credentials={newCredentials}
              onClose={() => setNewCredentials(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-label-secondary">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
