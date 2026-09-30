import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, MoreHorizontal } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import OrderStatusBadge from "@/components/shared/StatusBadge";
import FilterChip from "@/components/shared/FilterChip";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrders } from "@/features/orders";
import { useDrivers } from "@/features/drivers";
import DriverSelect from "@/components/delivery/DriverSelect";
import { Badge } from "@/components/ui/badge";
import { ASSIGNABLE_ORDER_STATUSES, isActiveDelivery } from "@/lib/deliveryStatus";
import { useAllDistributors } from "@/features/catalog";
import { useCities } from "@/features/ops";
import { useIsDistributorAdmin } from "@/store/useSessionStore";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/orderStatus";
import { formatJalaliShort } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import { downloadCsv, toCsv } from "@/lib/csv";
import { paths } from "@/routes/paths";
import type { Order, OrderStatus } from "@/types";

const RANGES = [
  { id: "all", label: "همه زمان‌ها", days: 0 },
  { id: "7", label: "۷ روز اخیر", days: 7 },
  { id: "30", label: "۳۰ روز اخیر", days: 30 },
];

export default function OrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isDistributor = useIsDistributorAdmin();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const status = (params.get("status") as OrderStatus | "all" | null) ?? "all";
  const distributorId = params.get("distributor") ?? "";
  const city = params.get("city") ?? "";
  const range = params.get("range") ?? "all";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rangeDays = RANGES.find((r) => r.id === range)?.days ?? 0;
  const from = rangeDays ? new Date(Date.now() - rangeDays * 86_400_000).toISOString() : undefined;

  const { data: all, isLoading } = useOrders({
    query,
    distributorId: distributorId || undefined,
    city: city || undefined,
    from,
  });
  const { data: distributors } = useAllDistributors();
  const { data: cities } = useCities();
  const { data: drivers } = useDrivers();
  const driverFilter = params.get("driver") ?? "all";

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all?.length ?? 0 };
    for (const s of ORDER_STATUSES) c[s] = all?.filter((o) => o.status === s).length ?? 0;
    return c;
  }, [all]);

  const rows = useMemo(() => {
    let list = status === "all" ? (all ?? []) : (all ?? []).filter((o) => o.status === status);
    if (driverFilter === "unassigned")
      list = list.filter((o) => ASSIGNABLE_ORDER_STATUSES.includes(o.status) && !isActiveDelivery(o.delivery));
    else if (driverFilter === "awaiting") list = list.filter((o) => o.delivery?.status === "awaiting_confirmation");
    else if (driverFilter !== "all")
      list = list.filter((o) => isActiveDelivery(o.delivery) && o.delivery?.driverId === driverFilter);
    return list;
  }, [all, status, driverFilter]);

  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      {
        accessorKey: "number",
        header: "شماره سفارش",
        cell: ({ row }) => (
          <Link
            to={paths.order(row.original.id)}
            className="ltr inline-block font-semibold hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: "retailerName",
        header: "فروشگاه",
        cell: ({ getValue }) => <span className="block max-w-44 truncate">{getValue<string>()}</span>,
      },
      ...(isDistributor
        ? []
        : [
            {
              accessorKey: "distributorName",
              header: "شرکت پخش",
              cell: ({ getValue }) => (
                <span className="block max-w-44 truncate text-label-secondary">{getValue<string>()}</span>
              ),
            } as ColumnDef<Order, unknown>,
          ]),
      {
        accessorKey: "city",
        header: "شهر",
        cell: ({ getValue }) => <span className="text-label-secondary">{getValue<string>()}</span>,
      },
      {
        id: "items",
        header: "اقلام",
        accessorFn: (o) => o.items.reduce((s, i) => s + i.qty, 0),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-label-secondary">
            {toFaNum(row.original.items.length)} قلم · {toFaNum(row.original.items.reduce((s, i) => s + i.qty, 0))}{" "}
            کارتن
          </span>
        ),
      },
      {
        accessorKey: "total",
        header: "مبلغ",
        cell: ({ getValue }) => <Price value={getValue<number>()} />,
      },
      {
        accessorKey: "deliveryDate",
        header: "تاریخ تحویل",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary">{formatJalaliShort(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "وضعیت",
        cell: ({ getValue }) => <OrderStatusBadge status={getValue<OrderStatus>()} />,
        enableSorting: false,
      },
      {
        id: "driver",
        header: "راننده",
        accessorFn: (o) => o.delivery?.driverName ?? "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <DriverSelect order={row.original} drivers={drivers ?? []} />
            {row.original.delivery?.status === "awaiting_confirmation" ? (
              <Badge variant="solid" className="text-[10px]">
                کد ثبت شد
              </Badge>
            ) : row.original.delivery?.status === "rejected" ? (
              <Badge variant="danger" className="text-[10px]">
                تحویل رد شد
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label="عملیات">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => navigate(paths.order(row.original.id))}>مشاهده سفارش</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(paths.retailer(row.original.retailerId))}>
                مشاهده فروشگاه
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [isDistributor, navigate, drivers],
  );

  const exportCsv = () => {
    downloadCsv(
      `orders-${new Date().toISOString().slice(0, 10)}`,
      toCsv(rows, [
        { header: "شماره سفارش", value: (o) => o.number },
        { header: "فروشگاه", value: (o) => o.retailerName },
        { header: "شرکت پخش", value: (o) => o.distributorName },
        { header: "شهر", value: (o) => o.city },
        { header: "مبلغ", value: (o) => o.total },
        { header: "وضعیت", value: (o) => ORDER_STATUS_LABELS[o.status] },
        { header: "راننده", value: (o) => (isActiveDelivery(o.delivery) ? (o.delivery?.driverName ?? "") : "") },
        { header: "تاریخ ثبت", value: (o) => o.createdAt },
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="سفارش‌ها"
        description="پیگیری، تایید و مدیریت وضعیت سفارش‌های فروشگاه‌ها"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download /> خروجی CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip
          label="همه"
          active={status === "all"}
          count={counts.all}
          onClick={() => setParam("status", "all")}
        />
        {ORDER_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={ORDER_STATUS_LABELS[s]}
            active={status === s}
            count={counts[s]}
            onClick={() => setParam("status", s)}
          />
        ))}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        onRowClick={(o) => navigate(paths.order(o.id))}
        emptyTitle="سفارشی با این فیلترها پیدا نشد"
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="شماره سفارش، نام یا شماره فروشگاه" />
            {!isDistributor ? (
              <Select value={distributorId || "all"} onValueChange={(v) => setParam("distributor", v)}>
                <SelectTrigger size="sm" className="w-44 bg-fill">
                  <SelectValue placeholder="شرکت پخش" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه شرکت‌های پخش</SelectItem>
                  {distributors?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select value={city || "all"} onValueChange={(v) => setParam("city", v)}>
              <SelectTrigger size="sm" className="w-32 bg-fill">
                <SelectValue placeholder="شهر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه شهرها</SelectItem>
                {cities?.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={driverFilter} onValueChange={(v) => setParam("driver", v)}>
              <SelectTrigger size="sm" className="w-40 bg-fill" aria-label="فیلتر راننده">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه رانندگان</SelectItem>
                <SelectItem value="unassigned">بدون راننده (قابل تخصیص)</SelectItem>
                <SelectItem value="awaiting">در انتظار تایید تحویل</SelectItem>
                {drivers
                  ?.filter((d) => d.active)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={(v) => setParam("range", v)}>
              <SelectTrigger size="sm" className="w-32 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </>
  );
}
