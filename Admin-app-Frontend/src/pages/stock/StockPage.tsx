import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Percent } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import EmptyState from "@/components/shared/EmptyState";
import SearchInput from "@/components/data-table/SearchInput";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDistributors, useProducts, useSetPriceMultiplier, useStock, useUpdateStock } from "@/features/catalog";
import { useCan, useIsDistributorAdmin } from "@/store/useSessionStore";
import { CATEGORIES } from "@/services/seed/catalog";
import { formatMultiplier, normalizePersian, toAsciiDigits, toFaNum } from "@/lib/format";
import type { StockEntry } from "@/types";
import { cn } from "@/lib/utils";

export default function StockPage() {
  const [params] = useSearchParams();
  const isDistributor = useIsDistributorAdmin();
  const canManage = useCan("stock.manage");
  const { data: distributors, isLoading: loadingDist } = useDistributors();
  const { data: products, isLoading: loadingProd } = useProducts();
  const { data: stock, isLoading: loadingStock } = useStock();
  const update = useUpdateStock();
  const setMultiplier = useSetPriceMultiplier();

  const [distributorId, setDistributorId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [onlyLow, setOnlyLow] = useState(false);

  useEffect(() => {
    if (!distributorId && distributors?.length) setDistributorId(distributors[0].id);
  }, [distributors, distributorId]);

  const distributor = distributors?.find((d) => d.id === distributorId);
  const highlight = params.get("product");

  const entries = useMemo(() => {
    const map = new Map<string, StockEntry>();
    for (const s of stock ?? []) if (s.distributorId === distributorId) map.set(s.productId, s);
    return map;
  }, [stock, distributorId]);

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (products ?? []).filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (q && !normalizePersian(`${p.name} ${p.brand} ${p.sku}`).includes(q)) return false;
      if (onlyLow) {
        const e = entries.get(p.id);
        if (!e?.available || e.cartonsLeft > 5) return false;
      }
      return true;
    });
  }, [products, query, category, onlyLow, entries]);

  const stats = useMemo(() => {
    const list = [...entries.values()];
    return {
      available: list.filter((e) => e.available).length,
      low: list.filter((e) => e.available && e.cartonsLeft <= 5).length,
      overrides: list.filter((e) => e.priceOverride != null).length,
    };
  }, [entries]);

  const loading = loadingDist || loadingProd || loadingStock;

  const patch = (productId: string, changes: Partial<StockEntry>) => {
    if (!canManage || !distributorId) return;
    update.mutate([{ distributorId, productId, ...changes }]);
  };

  const bulk = (available: boolean) => {
    if (!canManage || !distributorId) return;
    update.mutate(rows.map((p) => ({ distributorId, productId: p.id, available })));
  };

  return (
    <>
      <PageHeader
        title="موجودی و قیمت"
        description="موجودی، قیمت اختصاصی و ضریب قیمت هر شرکت پخش روی کاتالوگ مشترک"
        actions={
          distributor && canManage ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <Percent /> ضریب قیمت {formatMultiplier(distributor.priceMultiplier)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <MultiplierEditor
                  value={distributor.priceMultiplier}
                  loading={setMultiplier.isPending}
                  onSave={(m) =>
                    setMultiplier.mutate({
                      distributorId: distributor.id,
                      multiplier: m,
                    })
                  }
                />
              </PopoverContent>
            </Popover>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!isDistributor ? (
          <Select value={distributorId} onValueChange={setDistributorId}>
            <SelectTrigger className="w-60 bg-card">
              <SelectValue placeholder="شرکت پخش" />
            </SelectTrigger>
            <SelectContent>
              {distributors?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-[15px] font-semibold">{distributor?.name}</div>
        )}
        <div className="flex items-center gap-2 text-[12px] text-label-secondary">
          <Badge variant="neutral">{toFaNum(stats.available)} کالای فعال</Badge>
          {stats.low ? (
            <Badge variant="danger">
              <AlertTriangle className="size-3" /> {toFaNum(stats.low)} کمبود موجودی
            </Badge>
          ) : null}
          {stats.overrides ? <Badge variant="outline">{toFaNum(stats.overrides)} قیمت اختصاصی</Badge> : null}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <label className="flex items-center gap-2 text-[12px]">
          <Switch checked={onlyLow} onCheckedChange={setOnlyLow} /> فقط کمبود موجودی
        </label>
        {canManage ? (
          <div className="mr-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => bulk(true)} disabled={!rows.length}>
              فعال کردن همه ({toFaNum(rows.length)})
            </Button>
            <Button variant="ghost" size="sm" onClick={() => bulk(false)} disabled={!rows.length}>
              غیرفعال کردن همه
            </Button>
          </div>
        ) : null}
      </div>

      <Card>
        {loading ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="کالایی با این فیلترها نیست" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>کالا</TableHead>
                <TableHead>قیمت پایه</TableHead>
                <TableHead>قیمت فروش</TableHead>
                <TableHead>قیمت اختصاصی</TableHead>
                <TableHead>کارتن موجود</TableHead>
                <TableHead>موجود</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const e = entries.get(p.id) ?? {
                  distributorId,
                  productId: p.id,
                  available: false,
                  cartonsLeft: 0,
                };
                const sell = e.priceOverride ?? Math.round(p.price * (distributor?.priceMultiplier ?? 1));
                const low = e.available && e.cartonsLeft <= 5;
                return (
                  <TableRow key={p.id} className={cn(!e.available && "opacity-60", highlight === p.id && "bg-fill")}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img
                          src={p.img}
                          alt=""
                          className="size-9 shrink-0 rounded-lg bg-fill object-cover"
                          loading="lazy"
                        />
                        <div className="min-w-0">
                          <div className="max-w-64 truncate text-[13px] font-medium">{p.name}</div>
                          <div className="text-[12px] text-label-secondary">
                            {p.category} · {toFaNum(p.unitsPerCarton)} عدد در کارتن
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-label-secondary">
                      <Price value={p.price} />
                    </TableCell>
                    <TableCell className="font-semibold">
                      <Price value={sell} />
                      {e.priceOverride != null ? (
                        <Badge variant="outline" className="mr-2">
                          اختصاصی
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <NumberCell
                        value={e.priceOverride ?? ""}
                        placeholder="—"
                        disabled={!canManage}
                        width="w-32"
                        onCommit={(v) =>
                          patch(p.id, {
                            priceOverride: v === null ? undefined : v,
                          })
                        }
                        clearable
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <NumberCell
                          value={e.cartonsLeft}
                          disabled={!canManage}
                          width="w-20"
                          onCommit={(v) => patch(p.id, { cartonsLeft: v ?? 0 })}
                        />
                        {low ? <AlertTriangle className="size-4 text-destructive" aria-label="کمبود موجودی" /> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={e.available}
                        disabled={!canManage}
                        onCheckedChange={(v) => patch(p.id, { available: v })}
                        aria-label="موجود"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

function NumberCell({
  value,
  onCommit,
  disabled,
  placeholder,
  width,
  clearable,
}: {
  value: number | "";
  onCommit: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  width?: string;
  clearable?: boolean;
}) {
  const [draft, setDraft] = useState(value === "" ? "" : String(value));
  useEffect(() => setDraft(value === "" ? "" : String(value)), [value]);
  const commit = () => {
    const clean = toAsciiDigits(draft).replace(/[^\d]/g, "");
    if (clean === "") {
      if (clearable) onCommit(null);
      else setDraft(value === "" ? "" : String(value));
      return;
    }
    const n = Number(clean);
    if (n !== value) onCommit(n);
  };
  return (
    <Input
      value={draft ? Number(toAsciiDigits(draft).replace(/[^\d]/g, "") || 0).toLocaleString("fa-IR") : ""}
      onChange={(e) => setDraft(toAsciiDigits(e.target.value).replace(/[^\d]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value === "" ? "" : String(value));
      }}
      disabled={disabled}
      placeholder={placeholder}
      inputMode="numeric"
      className={cn(
        "h-8 rounded-lg bg-transparent px-2 text-[13px] tabular-nums hover:bg-fill focus-visible:bg-input",
        width,
      )}
    />
  );
}

function MultiplierEditor({
  value,
  onSave,
  loading,
}: {
  value: number;
  onSave: (v: number) => void;
  loading: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const parsed = Number(toAsciiDigits(draft));
  const valid = Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2;
  return (
    <div className="grid gap-3">
      <div>
        <div className="text-[13px] font-semibold">ضریب قیمت شرکت پخش</div>
        <p className="text-[12px] text-label-secondary">
          روی قیمت پایه همه کالاها اعمال می‌شود؛ قیمت اختصاصی اولویت دارد.
        </p>
      </div>
      <Input dir="ltr" value={draft} onChange={(e) => setDraft(e.target.value)} className="text-center" />
      {!valid ? <p className="text-[12px] text-destructive">عددی بین ۰٫۵ تا ۲ وارد کنید</p> : null}
      <Button
        size="sm"
        disabled={!valid || parsed === value}
        loading={loading}
        onClick={() => onSave(Number(parsed.toFixed(2)))}
      >
        ذخیره
      </Button>
    </div>
  );
}
