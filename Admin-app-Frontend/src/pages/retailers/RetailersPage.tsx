import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRetailersPage } from "@/features/people";
import { useOrders } from "@/features/orders";
import { useCities } from "@/features/ops";
import { normalizePersian, toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatJalaliShort, relativeLabel } from "@/lib/jalali";
import { downloadCsv, toCsv } from "@/lib/csv";
import { paths } from "@/routes/paths";
import type { Retailer, RetailerPlan } from "@/types";
import { PlanBadge } from "./components/PlanBadge";

type Row = Retailer & { orders: number; spent: number; lastOrderAt?: string };

/** One B33 page. The cursor stack is what makes "previous page" possible with keyset paging. */
const PAGE_SIZE = 20;

export default function RetailersPage() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<RetailerPlan | "all">("all");
  const { data: orders } = useOrders();
  const { data: cities } = useCities();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("all");
  const [status, setStatus] = useState<Retailer["status"] | "all">("all");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const after = cursors[cursors.length - 1] ?? null;
  const pageIndex = cursors.length - 1;

  // A changed filter starts a new list, so the old cursor must not survive it.
  useEffect(() => {
    setCursors([null]);
  }, [plan, query, city, status]);

  const { data: page, isLoading } = useRetailersPage({
    plan,
    q: query.trim() || undefined,
    city: city === "all" ? undefined : city,
    status,
    limit: PAGE_SIZE,
    after,
  });
  const retailers = page?.items;

  const rows = useMemo<Row[]>(() => {
    const q = normalizePersian(query.trim());
    return (retailers ?? [])
      .map((r) => {
        const mine = (orders ?? []).filter((o) => o.retailerId === r.id && o.status !== "cancelled");
        return {
          ...r,
          orders: mine.length,
          spent: mine.reduce((s, o) => s + o.total, 0),
          lastOrderAt: mine[0]?.createdAt,
        };
      })
      .filter((r) => {
        if (city !== "all" && r.city !== city) return false;
        if (plan !== "all" && r.plan !== plan) return false;
        if (status !== "all" && r.status !== status) return false;
        if (q && !normalizePersian(`${r.name} ${r.phone} ${r.city}`).includes(q)) return false;
        return true;
      });
  }, [retailers, orders, plan, query, city, status]);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "فروشگاه",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.name} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{row.original.name}</div>
              <div className="ltr text-right text-[12px] text-label-secondary">
                {formatPhoneDisplay(row.original.phone)}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "city",
        header: "شهر",
        cell: ({ getValue }) => <span className="text-label-secondary">{getValue<string>()}</span>,
      },
      {
        accessorKey: "primaryDistributorName",
        header: "شرکت پخش اصلی",
        cell: ({ row }) => (
          <span className="max-w-40 truncate text-label-secondary">{row.original.primaryDistributorName ?? "—"}</span>
        ),
      },
      {
        accessorKey: "plan",
        header: "پلن",
        cell: ({ row }) => <PlanBadge plan={row.original.plan ?? "free"} />,
      },
      {
        accessorKey: "orders",
        header: "سفارش‌ها",
        cell: ({ getValue }) => <span className="tabular-nums">{toFaNum(getValue<number>())}</span>,
      },
      {
        accessorKey: "spent",
        header: "مجموع خرید",
        cell: ({ getValue }) => <Price value={getValue<number>()} />,
      },
      {
        accessorKey: "walletBalance",
        header: "کیف پول",
        cell: ({ getValue }) => <Price value={getValue<number>()} />,
      },
      {
        accessorKey: "lastOrderAt",
        header: "آخرین سفارش",
        cell: ({ getValue }) => (
          <span className="text-label-secondary">
            {getValue<string | undefined>() ? relativeLabel(getValue<string>()) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "عضویت",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary">{formatJalaliShort(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "وضعیت",
        cell: ({ getValue }) =>
          getValue<string>() === "active" ? (
            <Badge variant="neutral">فعال</Badge>
          ) : (
            <Badge variant="danger">مسدود</Badge>
          ),
      },
    ],
    [],
  );

  const exportCsv = () =>
    downloadCsv(
      "retailers",
      toCsv(rows, [
        { header: "فروشگاه", value: (r) => r.name },
        { header: "موبایل", value: (r) => r.phone },
        { header: "شهر", value: (r) => r.city },
        { header: "شرکت پخش اصلی", value: (r) => r.primaryDistributorName ?? "" },
        { header: "پلن", value: (r) => (r.plan === "pro" ? "پرو" : "رایگان") },
        { header: "سفارش‌ها", value: (r) => r.orders },
        { header: "مجموع خرید", value: (r) => r.spent },
        { header: "وضعیت", value: (r) => r.status },
      ]),
    );

  return (
    <>
      <PageHeader
        title="فروشگاه‌ها"
        description={`${toFaNum(rows.length)} فروشگاه در این صفحه`}
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download /> خروجی CSV
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        onRowClick={(r) => navigate(paths.retailer(r.id))}
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="نام، موبایل یا شهر" />
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger size="sm" className="w-32 bg-fill">
                <SelectValue />
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
            <Select value={plan} onValueChange={(v) => setPlan(v as RetailerPlan | "all")}>
              <SelectTrigger size="sm" className="w-28 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه پلن‌ها</SelectItem>
                <SelectItem value="free">رایگان</SelectItem>
                <SelectItem value="pro">پرو</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as Retailer["status"] | "all")}>
              <SelectTrigger size="sm" className="w-28 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="active">فعال</SelectItem>
                <SelectItem value="blocked">مسدود</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
      {!isLoading && (pageIndex > 0 || page?.hasMore) ? (
        <div className="flex items-center justify-between px-1 text-[12px] text-label-secondary">
          <span className="tabular-nums">
            {toFaNum(pageIndex * PAGE_SIZE + 1)}–{toFaNum(pageIndex * PAGE_SIZE + rows.length)}
            {page?.hasMore ? "+" : ""}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCursors(cursors.slice(0, -1))}
              disabled={pageIndex === 0}
              aria-label="صفحه قبل"
            >
              <ChevronRight />
            </Button>
            <span className="min-w-8 text-center text-foreground tabular-nums">{toFaNum(pageIndex + 1)}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (page?.nextAfter) setCursors([...cursors, page.nextAfter]);
              }}
              disabled={!page?.hasMore}
              aria-label="صفحه بعد"
            >
              <ChevronLeft />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
