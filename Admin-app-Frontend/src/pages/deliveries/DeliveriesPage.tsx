import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, MapPin, Package, ShieldCheck, Truck, UserRound } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import FilterChip from "@/components/shared/FilterChip";
import DeliveryStatusBadge from "@/components/shared/DeliveryStatusBadge";
import DeliveryDecision from "@/components/delivery/DeliveryDecision";
import DataTable from "@/components/data-table/DataTable";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminNotifications, useDeliveries, useMarkAdminNotificationsRead } from "@/features/drivers";
import { useAllDistributors } from "@/features/catalog";
import { useIsDistributorAdmin } from "@/store/useSessionStore";
import { formatJalaliShort, formatTime, relativeLabel } from "@/lib/jalali";
import { toFaDigits, toFaNum } from "@/lib/format";
import { paths } from "@/routes/paths";
import type { Delivery } from "@/types";

type Tab = "awaiting" | "today" | "all";

export default function DeliveriesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "awaiting";
  const isDistributor = useIsDistributorAdmin();
  const { data: awaiting, isLoading: loadingAwaiting } = useDeliveries(
    { status: "awaiting_confirmation" },
    { poll: true },
  );
  const { data: history, isLoading: loadingHistory } = useDeliveries(tab === "today" ? { range: "today" } : {}, {
    poll: tab === "today",
  });
  const { data: notifications } = useAdminNotifications();
  const markRead = useMarkAdminNotificationsRead();
  const { data: distributors } = useAllDistributors();

  const unreadIds = useMemo(() => notifications?.filter((n) => !n.readAt).map((n) => n.id) ?? [], [notifications]);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    // Opening the queue acknowledges the bell; each item still needs an explicit decision.
    if (!seen && tab === "awaiting" && unreadIds.length) {
      setSeen(true);
      markRead.mutate(unreadIds);
    }
  }, [seen, tab, unreadIds, markRead]);

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
          <Link to={paths.order(row.original.orderId)} className="ltr inline-block font-semibold hover:underline">
            {row.original.orderNumber}
          </Link>
        ),
      },
      { accessorKey: "retailerName", header: "فروشگاه" },
      {
        accessorKey: "driverName",
        header: "راننده",
        cell: ({ row }) => (
          <Link to={paths.driver(row.original.driverId)} className="hover:underline">
            {row.original.driverName}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: "وضعیت",
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
        id: "decidedBy",
        header: "تصمیم",
        accessorFn: (d) => d.confirmedByName ?? d.rejectedByName ?? "",
        cell: ({ row }) => {
          const d = row.original;
          if (d.confirmedAt)
            return (
              <span className="text-[12px] text-label-secondary">
                تایید {d.confirmedByName}، {formatTime(d.confirmedAt)}
              </span>
            );
          if (d.rejectedAt)
            return (
              <span className="text-[12px] text-destructive" title={d.rejectionReason ?? undefined}>
                رد {d.rejectedByName}، {d.rejectionReason}
              </span>
            );
          return <span className="text-label-tertiary">—</span>;
        },
      },
    ],
    [],
  );

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "awaiting") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="تایید تحویل‌ها"
        description="راننده کد تحویل مشتری را ثبت کرده و سرور آن را معتبر دانسته است. سفارش فقط با تایید شما «تحویل شده» می‌شود."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip
          label="در انتظار تایید"
          active={tab === "awaiting"}
          count={awaiting?.length}
          onClick={() => setTab("awaiting")}
        />
        <FilterChip label="امروز" active={tab === "today"} onClick={() => setTab("today")} />
        <FilterChip label="همه" active={tab === "all"} onClick={() => setTab("all")} />
      </div>

      {tab === "awaiting" ? (
        loadingAwaiting ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : !awaiting?.length ? (
          <Card>
            <EmptyState
              icon={<CheckCircle2 />}
              title="تحویلی در انتظار تایید نیست"
              description="وقتی راننده کد تحویل معتبر ثبت کند، اینجا و در اعلان‌ها نمایش داده می‌شود."
            />
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {awaiting.map((d) => (
              <Card key={d.id} className="gap-0 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-label-secondary">
                      <ShieldCheck className="size-4 text-foreground" /> کد تحویل معتبر
                      {d.submittedAt ? <span>، {relativeLabel(d.submittedAt)}</span> : null}
                    </div>
                    <div className="mt-1.5 text-[17px] font-bold">{d.retailerName}</div>
                  </div>
                  <Link to={paths.order(d.orderId)} className="ltr text-[13px] font-semibold hover:underline">
                    {d.orderNumber}
                  </Link>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <Item icon={<UserRound />} label="راننده">
                    <Link to={paths.driver(d.driverId)} className="hover:underline">
                      {d.driverName}
                    </Link>
                  </Item>
                  <Item icon={<Truck />} label="زمان ثبت">
                    {d.submittedAt ? formatTime(d.submittedAt) : "—"}
                  </Item>
                  <Item icon={<Package />} label="بار">
                    {toFaNum(d.cartons)} کارتن، ساعت {toFaDigits(d.deliverySlot)}
                  </Item>
                  <Item icon={<MapPin />} label="شهر">
                    {d.city}
                  </Item>
                </dl>
                {!isDistributor ? (
                  <p className="mt-2 text-[12px] text-label-tertiary">
                    شرکت پخش: {distributors?.find((x) => x.id === d.distributorId)?.name ?? "—"}
                  </p>
                ) : null}
                <div className="mt-4 border-t border-border pt-4">
                  <DeliveryDecision delivery={d} />
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <DataTable columns={columns} data={history ?? []} loading={loadingHistory} emptyTitle="تحویلی ثبت نشده" />
      )}
    </>
  );
}

function Item({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label-tertiary [&_svg]:size-3.5">{icon}</span>
      <dt className="text-label-secondary">{label}:</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
