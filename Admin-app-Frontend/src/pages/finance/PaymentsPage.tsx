import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { CreditCard, Download, Wallet } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import StatCard from "@/components/shared/StatCard";
import { PaymentStatusBadge } from "@/components/shared/StatusBadge";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePayments } from "@/features/ops";
import { normalizePersian, toFaNum } from "@/lib/format";
import { formatJalaliDateTime } from "@/lib/jalali";
import { downloadCsv, toCsv } from "@/lib/csv";
import { paths } from "@/routes/paths";
import type { Payment } from "@/types";

export default function PaymentsPage() {
  const { data: payments, isLoading } = usePayments();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (payments ?? []).filter((p) => {
      if (kind !== "all" && p.kind !== kind) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q && !normalizePersian(`${p.retailerName} ${p.orderNumber ?? ""} ${p.id}`).includes(q)) return false;
      return true;
    });
  }, [payments, query, kind, status]);

  const stats = useMemo(() => {
    const ok = (payments ?? []).filter((p) => p.status === "success");
    const day = Date.now() - 86_400_000 * 7;
    return {
      total: ok.reduce((s, p) => s + p.amount, 0),
      week: ok.filter((p) => new Date(p.createdAt).getTime() > day).reduce((s, p) => s + p.amount, 0),
      failed: (payments ?? []).filter((p) => p.status === "failed").length,
      walletShare: ok.length ? Math.round((ok.filter((p) => p.method === "wallet").length / ok.length) * 100) : 0,
    };
  }, [payments]);

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        header: "شناسه",
        cell: ({ getValue }) => (
          <span className="ltr inline-block text-[12px] text-label-secondary">{getValue<string>().toUpperCase()}</span>
        ),
      },
      {
        accessorKey: "kind",
        header: "نوع",
        cell: ({ row }) =>
          row.original.kind === "order" ? (
            <span className="flex items-center gap-1.5">
              پرداخت سفارش
              {row.original.orderNumber ? (
                <Link
                  to={paths.orders + `?q=${row.original.orderNumber}`}
                  className="ltr inline-block text-[12px] text-label-secondary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.original.orderNumber}
                </Link>
              ) : null}
            </span>
          ) : row.original.kind === "subscription" ? (
            <span>اشتراک پرو</span>
          ) : (
            <span>شارژ کیف پول</span>
          ),
      },
      {
        accessorKey: "retailerName",
        header: "فروشگاه",
        cell: ({ row }) => (
          <Link
            to={paths.retailer(row.original.retailerId)}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.retailerName}
          </Link>
        ),
      },
      {
        accessorKey: "method",
        header: "روش",
        cell: ({ getValue }) => (
          <Badge variant="muted">
            {getValue<string>() === "wallet" ? <Wallet className="size-3" /> : <CreditCard className="size-3" />}
            {getValue<string>() === "wallet" ? "کیف پول" : "درگاه"}
          </Badge>
        ),
      },
      {
        accessorKey: "amount",
        header: "مبلغ",
        cell: ({ getValue }) => <Price value={getValue<number>()} className="font-semibold" />,
      },
      {
        accessorKey: "status",
        header: "وضعیت",
        cell: ({ getValue }) => <PaymentStatusBadge status={getValue<Payment["status"]>()} />,
      },
      {
        accessorKey: "createdAt",
        header: "زمان",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary tabular-nums">
            {formatJalaliDateTime(getValue<string>())}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="پرداخت‌ها"
        description="تراکنش‌های درگاه بانکی و کیف پول برای سفارش‌ها و شارژ اعتبار"
        actions={
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                "payments",
                toCsv(rows, [
                  { header: "شناسه", value: (p) => p.id },
                  { header: "نوع", value: (p) => p.kind },
                  { header: "فروشگاه", value: (p) => p.retailerName },
                  { header: "مبلغ", value: (p) => p.amount },
                  { header: "روش", value: (p) => p.method },
                  { header: "وضعیت", value: (p) => p.status },
                  { header: "زمان", value: (p) => p.createdAt },
                ]),
              )
            }
          >
            <Download /> خروجی CSV
          </Button>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="مجموع تراکنش‌های موفق" value={<Price value={stats.total} />} loading={isLoading} />
        <StatCard label="۷ روز اخیر" value={<Price value={stats.week} />} loading={isLoading} />
        <StatCard
          label="سهم کیف پول"
          value={`${toFaNum(stats.walletShare)}٪`}
          hint="از تراکنش‌های موفق"
          loading={isLoading}
        />
        <StatCard label="تراکنش ناموفق" value={toFaNum(stats.failed)} loading={isLoading} />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="فروشگاه، شماره سفارش یا شناسه" />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger size="sm" className="w-32 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه انواع</SelectItem>
                <SelectItem value="order">پرداخت سفارش</SelectItem>
                <SelectItem value="wallet">شارژ کیف پول</SelectItem>
                <SelectItem value="subscription">اشتراک پرو</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-28 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="success">موفق</SelectItem>
                <SelectItem value="failed">ناموفق</SelectItem>
                <SelectItem value="pending">در انتظار</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
    </>
  );
}
