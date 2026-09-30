import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { SlidersHorizontal } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import StatCard from "@/components/shared/StatCard";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useWallets } from "@/features/ops";
import { useCan } from "@/store/useSessionStore";
import { normalizePersian, toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { relativeLabel } from "@/lib/jalali";
import { paths } from "@/routes/paths";
import type { WalletAccount } from "@/types";
import WalletAdjustDialog from "./components/WalletAdjustDialog";

export default function WalletsPage() {
  const canAdjust = useCan("finance.adjust");
  const { data: wallets, isLoading } = useWallets();
  const [query, setQuery] = useState("");
  const [adjusting, setAdjusting] = useState<WalletAccount | null>(null);

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (wallets ?? []).filter((w) => !q || normalizePersian(`${w.retailerName} ${w.phone}`).includes(q));
  }, [wallets, query]);

  const stats = useMemo(() => {
    const list = wallets ?? [];
    const total = list.reduce((s, w) => s + w.balance, 0);
    return {
      total,
      count: list.filter((w) => w.balance > 0).length,
      adjustments: list.reduce((s, w) => s + w.transactions.filter((t) => t.kind === "adjustment").length, 0),
    };
  }, [wallets]);

  const columns = useMemo<ColumnDef<WalletAccount, unknown>[]>(
    () => [
      {
        accessorKey: "retailerName",
        header: "فروشگاه",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.retailerName} size="sm" />
            <div className="min-w-0">
              <Link
                to={paths.retailer(row.original.retailerId)}
                className="block truncate text-[13px] font-medium hover:underline"
              >
                {row.original.retailerName}
              </Link>
              <div className="ltr text-right text-[12px] text-label-secondary">
                {formatPhoneDisplay(row.original.phone)}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "balance",
        header: "موجودی",
        cell: ({ getValue }) => <Price value={getValue<number>()} className="font-semibold" />,
      },
      {
        id: "tx",
        header: "تراکنش‌ها",
        accessorFn: (w) => w.transactions.length,
        cell: ({ getValue }) => <span className="tabular-nums">{toFaNum(getValue<number>())}</span>,
      },
      {
        id: "topups",
        header: "مجموع شارژ",
        accessorFn: (w) =>
          w.transactions.filter((t) => t.kind === "topup" && t.status === "success").reduce((s, t) => s + t.amount, 0),
        cell: ({ getValue }) => <Price value={getValue<number>()} />,
      },
      {
        id: "last",
        header: "آخرین تراکنش",
        accessorFn: (w) => w.transactions[0]?.createdAt ?? "",
        cell: ({ getValue }) => (
          <span className="text-label-secondary">{getValue<string>() ? relativeLabel(getValue<string>()) : "—"}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          canAdjust ? (
            <Button variant="outline" size="sm" onClick={() => setAdjusting(row.original)}>
              <SlidersHorizontal /> تعدیل
            </Button>
          ) : null,
      },
    ],
    [canAdjust],
  );

  return (
    <>
      <PageHeader title="کیف پول‌ها" description="اعتبار فروشگاه‌ها؛ تعدیل دستی با ثبت دلیل در گزارش فعالیت" />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="مجموع اعتبار فروشگاه‌ها" value={<Price value={stats.total} />} loading={isLoading} />
        <StatCard label="کیف پول‌های دارای اعتبار" value={toFaNum(stats.count)} loading={isLoading} />
        <StatCard label="تعدیل‌های دستی" value={toFaNum(stats.adjustments)} loading={isLoading} />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        toolbar={<SearchInput value={query} onChange={setQuery} placeholder="فروشگاه یا موبایل" />}
      />
      {adjusting ? <WalletAdjustDialog open onOpenChange={(v) => !v && setAdjusting(null)} wallet={adjusting} /> : null}
    </>
  );
}
