import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteProduct, useProducts, useSetProductActive, useStock } from "@/features/catalog";
import { useCan } from "@/store/useSessionStore";
import { CATEGORIES } from "@/services/seed/catalog";
import { normalizePersian, toFaNum } from "@/lib/format";
import { paths } from "@/routes/paths";
import type { Product } from "@/types";

export default function ProductsPage() {
  const navigate = useNavigate();
  const canManage = useCan("products.manage");
  const { data: products, isLoading } = useProducts();
  const { data: stock } = useStock();
  const setActive = useSetProductActive();
  const remove = useDeleteProduct();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [deleting, setDeleting] = useState<Product | null>(null);

  const availability = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stock ?? []) if (s.available) map.set(s.productId, (map.get(s.productId) ?? 0) + 1);
    return map;
  }, [stock]);

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (products ?? []).filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (status === "active" && !p.active) return false;
      if (status === "inactive" && p.active) return false;
      if (q && !normalizePersian(`${p.name} ${p.brand} ${p.sku}`).includes(q)) return false;
      return true;
    });
  }, [products, query, category, status]);

  const columns = useMemo<ColumnDef<Product, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "کالا",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <img
              src={row.original.img}
              alt=""
              className="size-10 shrink-0 rounded-lg bg-fill object-cover"
              loading="lazy"
            />
            <div className="min-w-0">
              <Link
                to={paths.product(row.original.id)}
                className="block max-w-64 truncate text-[13px] font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {row.original.name}
              </Link>
              <div className="text-[12px] text-label-secondary">
                {row.original.brand} · <span className="ltr inline-block">{row.original.sku}</span>
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "category",
        header: "دسته",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-label-secondary">
            {row.original.category} / {row.original.subCategory}
          </span>
        ),
      },
      {
        accessorKey: "unitsPerCarton",
        header: "در کارتن",
        cell: ({ getValue }) => <span className="tabular-nums">{toFaNum(getValue<number>())} عدد</span>,
      },
      {
        accessorKey: "price",
        header: "قیمت پایه",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <Price value={row.original.price} />
            {row.original.disc ? (
              <span className="text-[11px] text-label-tertiary">
                <span className="line-through">{toFaNum(row.original.original ?? 0)}</span> ·{" "}
                {toFaNum(row.original.disc)}٪
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "availability",
        header: "پخش‌های فعال",
        accessorFn: (p) => availability.get(p.id) ?? 0,
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return <Badge variant={n ? "neutral" : "muted"}>{n ? `${toFaNum(n)} شرکت` : "بدون موجودی"}</Badge>;
        },
      },
      {
        accessorKey: "active",
        header: "فعال",
        enableSorting: false,
        cell: ({ row }) => (
          <Switch
            checked={row.original.active}
            disabled={!canManage}
            onCheckedChange={(v) => setActive.mutate({ id: row.original.id, active: v })}
            onClick={(e) => e.stopPropagation()}
            aria-label="فعال"
          />
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
              <DropdownMenuItem onSelect={() => navigate(paths.product(row.original.id))}>
                {canManage ? "ویرایش" : "مشاهده"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`${paths.stock}?product=${row.original.id}`)}>
                موجودی در پخش‌ها
              </DropdownMenuItem>
              {canManage ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setDeleting(row.original)}>
                    <Trash2 /> حذف
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [availability, canManage, navigate, setActive],
  );

  return (
    <>
      <PageHeader
        title="محصولات"
        description={`${toFaNum(products?.length ?? 0)} کالا در کاتالوگ مشترک همه شرکت‌های پخش`}
        actions={
          canManage ? (
            <Button asChild>
              <Link to={paths.productNew}>
                <Plus /> محصول جدید
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        onRowClick={(p) => navigate(paths.product(p.id))}
        emptyTitle="محصولی پیدا نشد"
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="نام، برند یا SKU" />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger size="sm" className="w-36 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه دسته‌ها</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-28 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="active">فعال</SelectItem>
                <SelectItem value="inactive">غیرفعال</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="حذف محصول"
        description={`«${deleting?.name}» از کاتالوگ و موجودی همه شرکت‌های پخش حذف می‌شود. سفارش‌های قبلی تغییری نمی‌کنند.`}
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
