import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Star } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDistributors } from "@/features/catalog";
import { useOrders } from "@/features/orders";
import { useCan } from "@/store/useSessionStore";
import { formatMultiplier, normalizePersian, toFaDigits, toFaNum } from "@/lib/format";
import { paths } from "@/routes/paths";
import type { Distributor } from "@/types";
import DistributorFormDialog from "./components/DistributorFormDialog";

export default function DistributorsPage() {
  const navigate = useNavigate();
  const canManage = useCan("distributors.manage");
  const { data: distributors, isLoading } = useDistributors();
  const { data: orders } = useOrders();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const gmv = useMemo(() => {
    const m = new Map<string, { gmv: number; orders: number }>();
    for (const o of orders ?? []) {
      if (o.status === "cancelled") continue;
      const c = m.get(o.distributorId) ?? { gmv: 0, orders: 0 };
      m.set(o.distributorId, { gmv: c.gmv + o.total, orders: c.orders + 1 });
    }
    return m;
  }, [orders]);

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (distributors ?? []).filter(
      (d) => !q || normalizePersian(`${d.name} ${d.cities.join(" ")} ${d.managerName ?? ""}`).includes(q),
    );
  }, [distributors, query]);

  const columns = useMemo<ColumnDef<Distributor, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "شرکت پخش",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-center text-[9px] leading-tight font-bold whitespace-pre-line text-primary-foreground">
              {row.original.logoText}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                <span className="truncate">{row.original.name}</span>
                {row.original.pro ? (
                  <Badge variant="solid" className="px-1.5 text-[9px]">
                    PRO
                  </Badge>
                ) : null}
              </div>
              <div className="text-[12px] text-label-secondary">{row.original.managerName ?? "—"}</div>
            </div>
          </div>
        ),
      },
      {
        id: "cities",
        header: "شهرها",
        accessorFn: (d) => d.cities.join("، "),
        cell: ({ getValue }) => (
          <span className="block max-w-44 truncate text-label-secondary">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "وضعیت",
        cell: ({ getValue }) =>
          getValue<string>() === "active" ? (
            <Badge variant="neutral">فعال</Badge>
          ) : (
            <Badge variant="muted">ظرفیت پر</Badge>
          ),
      },
      {
        accessorKey: "priceMultiplier",
        header: "ضریب",
        cell: ({ getValue }) => <span className="tabular-nums">{formatMultiplier(getValue<number>())}</span>,
      },
      {
        accessorKey: "deliveryFee",
        header: "هزینه ارسال",
        cell: ({ getValue }) =>
          getValue<number | "free">() === "free" ? (
            <span className="text-label-secondary">رایگان</span>
          ) : (
            <Price value={getValue<number>()} />
          ),
      },
      {
        accessorKey: "deliveryMins",
        header: "زمان تحویل",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap tabular-nums">{toFaNum(getValue<number>())} دقیقه</span>
        ),
      },
      {
        accessorKey: "rating",
        header: "امتیاز",
        cell: ({ getValue }) => (
          <span className="flex items-center gap-1 tabular-nums">
            <Star className="size-3.5 fill-current" /> {toFaDigits(getValue<number>().toFixed(1))}
          </span>
        ),
      },
      {
        id: "orders",
        header: "سفارش‌ها",
        accessorFn: (d) => gmv.get(d.id)?.orders ?? 0,
        cell: ({ getValue }) => <span className="tabular-nums">{toFaNum(getValue<number>())}</span>,
      },
      {
        id: "gmv",
        header: "فروش",
        accessorFn: (d) => gmv.get(d.id)?.gmv ?? 0,
        cell: ({ getValue }) => <Price value={getValue<number>()} />,
      },
    ],
    [gmv],
  );

  return (
    <>
      <PageHeader
        title="شرکت‌های پخش"
        description={`${toFaNum(distributors?.length ?? 0)} شرکت پخش فعال در پلتفرم`}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> شرکت پخش جدید
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        onRowClick={(d) => navigate(paths.distributor(d.id))}
        toolbar={<SearchInput value={query} onChange={setQuery} placeholder="نام، شهر یا مدیر" />}
      />
      <DistributorFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
