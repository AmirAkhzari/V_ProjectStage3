import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Crown, Download } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import StatCard from "@/components/shared/StatCard";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSubscriptions } from "@/features/subscriptions";
import { normalizePersian, toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatJalali } from "@/lib/jalali";
import { downloadCsv, toCsv } from "@/lib/csv";
import { paths } from "@/routes/paths";
import { PlanBadge, SubscriptionStatusBadge } from "@/pages/retailers/components/PlanBadge";
import type { RetailerPlan, SubscriptionListItem, SubscriptionStatus } from "@/types";

export default function SubscriptionsPage() {
  const [plan, setPlan] = useState<RetailerPlan | "all">("all");
  const [status, setStatus] = useState<SubscriptionStatus | "all">("all");
  const { data, isLoading } = useSubscriptions({
    plan: plan === "all" ? undefined : plan,
    status: status === "all" ? undefined : status,
  });
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (data?.items ?? []).filter((row) => {
      if (!q) return true;
      return normalizePersian(`${row.retailerName} ${row.retailerPhone} ${row.id}`).includes(q);
    });
  }, [data?.items, query]);

  const summary = data?.summary ?? { total: 0, active: 0, revenue: 0 };

  const columns = useMemo<ColumnDef<SubscriptionListItem, unknown>[]>(
    () => [
      {
        accessorKey: "retailerName",
        header: "فروشگاه",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link to={paths.retailer(row.original.retailerId)} className="block truncate font-medium hover:underline">
              {row.original.retailerName}
            </Link>
            <div className="ltr text-right text-[12px] text-label-secondary">
              {formatPhoneDisplay(row.original.retailerPhone)}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "plan",
        header: "پلن",
        cell: ({ getValue }) => <PlanBadge plan={getValue<RetailerPlan>()} />,
      },
      {
        accessorKey: "status",
        header: "وضعیت",
        cell: ({ getValue }) => <SubscriptionStatusBadge status={getValue<SubscriptionStatus>()} />,
      },
      {
        accessorKey: "startsAt",
        header: "شروع",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary">{formatJalali(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: "expiresAt",
        header: "انقضا",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary">{formatJalali(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: "paymentId",
        header: "پرداخت",
        cell: ({ getValue }) => (
          <span className="ltr inline-block text-[12px] text-label-tertiary">{getValue<string | null>() ?? "—"}</span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="اشتراک‌ها"
        description="اشتراک پرو فروشگاه‌ها برای دسترسی به بازار شهر"
        actions={
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                "subscriptions",
                toCsv(rows, [
                  { header: "فروشگاه", value: (r) => r.retailerName },
                  { header: "موبایل", value: (r) => r.retailerPhone },
                  { header: "پلن", value: (r) => (r.plan === "pro" ? "پرو" : "رایگان") },
                  { header: "وضعیت", value: (r) => r.status },
                  { header: "شروع", value: (r) => r.startsAt },
                  { header: "انقضا", value: (r) => r.expiresAt },
                ]),
              )
            }
          >
            <Download /> خروجی CSV
          </Button>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="کل رکوردها" value={toFaNum(summary.total)} loading={isLoading} />
        <StatCard
          label="اشتراک فعال"
          value={toFaNum(summary.active)}
          hint="پلن پرو معتبر"
          loading={isLoading}
          icon={<Crown className="size-4" />}
        />
        <StatCard label="درآمد اشتراک" value={<Price value={summary.revenue} />} loading={isLoading} />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="فروشگاه، موبایل یا شناسه" />
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
            <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus | "all")}>
              <SelectTrigger size="sm" className="w-28 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                <SelectItem value="active">فعال</SelectItem>
                <SelectItem value="expired">منقضی</SelectItem>
                <SelectItem value="cancelled">لغو شده</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
    </>
  );
}
