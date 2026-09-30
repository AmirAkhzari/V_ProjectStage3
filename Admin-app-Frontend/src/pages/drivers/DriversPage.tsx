import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Hourglass, PackageCheck, Plus, Truck, UserRound } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import Can from "@/components/shared/Can";
import { ActiveBadge } from "@/components/shared/StatusBadge";
import FilterChip from "@/components/shared/FilterChip";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDrivers } from "@/features/drivers";
import { useIsDistributorAdmin } from "@/store/useSessionStore";
import { formatPhoneDisplay } from "@/lib/phone";
import { relativeLabel } from "@/lib/jalali";
import { normalizePersian, toFaNum } from "@/lib/format";
import { paths } from "@/routes/paths";
import type { DriverListItem } from "@/types";
import DriverFormDialog from "./components/DriverFormDialog";

export default function DriversPage() {
  const navigate = useNavigate();
  const isDistributor = useIsDistributorAdmin();
  const { data: drivers, isLoading } = useDrivers();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (drivers ?? [])
      .filter((d) => status === "all" || (status === "active" ? d.active : !d.active))
      .filter((d) => !q || normalizePersian(`${d.name} ${d.username} ${d.phone}`).includes(q));
  }, [drivers, query, status]);

  const totals = useMemo(() => {
    const list = drivers ?? [];
    return {
      active: list.filter((d) => d.active).length,
      today: list.reduce((s, d) => s + d.today.total, 0),
      confirmed: list.reduce((s, d) => s + d.today.confirmed, 0),
      awaiting: list.reduce((s, d) => s + d.today.awaiting, 0),
    };
  }, [drivers]);

  const columns = useMemo<ColumnDef<DriverListItem, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "راننده",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.name} size="sm" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{row.original.name}</div>
              <div className="ltr text-right text-[12px] text-label-secondary">{row.original.username}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "phone",
        header: "موبایل",
        cell: ({ getValue }) => (
          <span className="ltr inline-block text-label-secondary">{formatPhoneDisplay(getValue<string>())}</span>
        ),
      },
      ...(isDistributor
        ? []
        : [
            {
              accessorKey: "distributorName",
              header: "شرکت پخش",
              cell: ({ getValue }) => <span className="text-label-secondary">{getValue<string>()}</span>,
            } as ColumnDef<DriverListItem, unknown>,
          ]),
      {
        id: "vehicle",
        header: "خودرو",
        accessorFn: (d) => d.vehicle?.type ?? "",
        cell: ({ row }) =>
          row.original.vehicle ? (
            <div className="text-[12px]">
              <div>{row.original.vehicle.type}</div>
              <div className="text-label-tertiary">{row.original.vehicle.plate}</div>
            </div>
          ) : (
            <span className="text-label-tertiary">—</span>
          ),
      },
      {
        id: "today",
        header: "توزیع امروز",
        accessorFn: (d) => d.today.total,
        cell: ({ row }) => {
          const t = row.original.today;
          if (!t.total) return <span className="text-label-tertiary">بدون سفارش</span>;
          return (
            <div className="min-w-32">
              <div className="flex items-center justify-between text-[12px]">
                <span className="tabular-nums">
                  {toFaNum(t.confirmed)} از {toFaNum(t.total)}
                </span>
                {t.awaiting ? (
                  <Badge variant="solid" className="text-[10px]">
                    {toFaNum(t.awaiting)} منتظر تایید
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-fill">
                <span className="bg-primary" style={{ width: `${(t.confirmed / t.total) * 100}%` }} />
                <span className="bg-label-tertiary" style={{ width: `${(t.awaiting / t.total) * 100}%` }} />
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "lastLoginAt",
        header: "آخرین ورود",
        cell: ({ getValue }) => (
          <span className="text-label-secondary">
            {getValue<string | undefined>() ? relativeLabel(getValue<string>()) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "active",
        header: "وضعیت",
        cell: ({ getValue }) => <ActiveBadge active={getValue<boolean>()} />,
      },
    ],
    [isDistributor],
  );

  return (
    <>
      <PageHeader
        title="رانندگان"
        description="حساب رانندگان توزیع، مسیر امروز و فعالیت تحویل"
        actions={
          <Can perm="drivers.manage">
            <Button onClick={() => setCreating(true)}>
              <Plus /> راننده جدید
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="رانندگان فعال" value={toFaNum(totals.active)} icon={<UserRound />} loading={isLoading} />
        <StatCard label="سفارش‌های امروز" value={toFaNum(totals.today)} icon={<Truck />} loading={isLoading} />
        <StatCard
          label="تحویل تاییدشده"
          value={toFaNum(totals.confirmed)}
          icon={<PackageCheck />}
          loading={isLoading}
        />
        <StatCard
          label="در انتظار تایید شما"
          value={toFaNum(totals.awaiting)}
          icon={<Hourglass />}
          loading={isLoading}
          hint={totals.awaiting ? "از صفحه تایید تحویل بررسی کنید" : undefined}
        />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        onRowClick={(d) => navigate(paths.driver(d.id))}
        emptyTitle={drivers?.length ? "راننده‌ای با این فیلتر پیدا نشد" : "هنوز راننده‌ای ثبت نشده"}
        emptyDescription={drivers?.length ? undefined : "برای شروع توزیع، حساب اولین راننده را بسازید."}
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="نام، شناسه یا موبایل" />
            <FilterChip label="همه" active={status === "all"} onClick={() => setStatus("all")} />
            <FilterChip label="فعال" active={status === "active"} onClick={() => setStatus("active")} />
            <FilterChip label="غیرفعال" active={status === "inactive"} onClick={() => setStatus("inactive")} />
          </>
        }
      />
      <DriverFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
