import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCoupons, useDeleteCoupon, useSaveCoupon } from "@/features/marketing";
import { useAllDistributors } from "@/features/catalog";
import { useCan } from "@/store/useSessionStore";
import { normalizePersian, toFaNum } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import type { Coupon } from "@/types";
import CouponFormDialog from "./components/CouponFormDialog";

export default function CouponsPage() {
  const canManage = useCan("coupons.manage");
  const { data: coupons, isLoading } = useCoupons();
  const { data: distributors } = useAllDistributors();
  const save = useSaveCoupon();
  const remove = useDeleteCoupon();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Coupon | null | "new">(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (coupons ?? []).filter((c) => !q || normalizePersian(`${c.code} ${c.title}`).includes(q));
  }, [coupons, query]);

  const columns = useMemo<ColumnDef<Coupon, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "کد",
        cell: ({ row }) => (
          <div>
            <button
              type="button"
              className="ltr inline-flex items-center gap-1.5 rounded-md bg-fill px-2 py-0.5 text-[12px] font-bold hover:bg-fill-secondary"
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard?.writeText(row.original.code);
                toast.success("کد کپی شد");
              }}
            >
              {row.original.code} <Copy className="size-3 text-label-secondary" />
            </button>
            <div className="mt-1 text-[12px] text-label-secondary">{row.original.title}</div>
          </div>
        ),
      },
      {
        id: "value",
        header: "مقدار",
        accessorFn: (c) => c.value,
        cell: ({ row }) =>
          row.original.kind === "percent" ? (
            <span className="tabular-nums">{toFaNum(row.original.value)}٪</span>
          ) : (
            <Price value={row.original.value} />
          ),
      },
      {
        accessorKey: "minTotal",
        header: "حداقل سبد",
        cell: ({ getValue }) =>
          getValue<number | undefined>() ? (
            <Price value={getValue<number>()} />
          ) : (
            <span className="text-label-tertiary">—</span>
          ),
      },
      {
        id: "scope",
        header: "محدوده",
        accessorFn: (c) => c.distributorId ?? "",
        cell: ({ row }) => (
          <span className="text-label-secondary">
            {row.original.distributorId
              ? (distributors?.find((d) => d.id === row.original.distributorId)?.name ?? "—")
              : "همه پخش‌ها"}
          </span>
        ),
      },
      {
        id: "usage",
        header: "استفاده",
        accessorFn: (c) => c.usedCount,
        cell: ({ row }) => {
          const pct = row.original.maxUses
            ? Math.min(100, (row.original.usedCount / row.original.maxUses) * 100)
            : null;
          return (
            <div className="min-w-28">
              <div className="text-[12px] tabular-nums">
                {toFaNum(row.original.usedCount)}
                {row.original.maxUses ? ` / ${toFaNum(row.original.maxUses)}` : ""}
              </div>
              {pct != null ? (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-fill">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "expiresAt",
        header: "انقضا",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary">{formatJalali(getValue<string>())}</span>
        ),
      },
      {
        id: "status",
        header: "وضعیت",
        accessorFn: (c) => (c.active && new Date(c.expiresAt) > new Date() ? "active" : "inactive"),
        cell: ({ row }) => {
          const expired = new Date(row.original.expiresAt) < new Date();
          return !row.original.active ? (
            <Badge variant="muted">غیرفعال</Badge>
          ) : expired ? (
            <Badge variant="danger">منقضی</Badge>
          ) : (
            <Badge variant="neutral">فعال</Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="عملیات">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(row.original)}>ویرایش</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    save.mutate({
                      ...row.original,
                      active: !row.original.active,
                    })
                  }
                >
                  {row.original.active ? "غیرفعال کردن" : "فعال کردن"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setDeleting(row.original)}>
                  <Trash2 /> حذف
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [canManage, distributors, save],
  );

  return (
    <>
      <PageHeader
        title="کدهای تخفیف"
        description="کدهای تخفیف درصدی یا مبلغی با محدوده شرکت پخش و سقف استفاده"
        actions={
          canManage ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> کد جدید
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        onRowClick={canManage ? (c) => setEditing(c) : undefined}
        toolbar={<SearchInput value={query} onChange={setQuery} placeholder="کد یا عنوان" />}
      />
      <CouponFormDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        coupon={editing === "new" ? undefined : (editing ?? undefined)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="حذف کد تخفیف"
        description={`کد ${deleting?.code} حذف می‌شود و دیگر قابل استفاده نیست.`}
        confirmLabel="حذف"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}
