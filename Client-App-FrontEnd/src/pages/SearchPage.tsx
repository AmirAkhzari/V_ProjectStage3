import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconSearch, IconX } from "@/components/icons";
import { SEARCH_CATEGORIES, TRENDING } from "@/data/catalog";
import { api } from "@/services/client";
import { goBack } from "@/lib/navigation";
import { toFaNum } from "@/lib/format";
import { getDistributor } from "@/lib/distributors";
import type { Product } from "@/types";
import ProductImage from "@/components/ui/ProductImage";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { IlluSearch } from "@/components/illustrations";
import { useAppStore } from "@/store/useAppStore";

export default function SearchPage() {
  const navigate = useNavigate();
  const distributorId = useAppStore((s) => s.distributorId);
  const distributors = useAppStore((s) => s.distributors);
  const catalogs = useAppStore((s) => s.catalogs);
  const config = useAppStore((s) => s.config);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const distributor = getDistributor(distributorId, distributors);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadCatalog(distributorId);
  }, [distributorId, loadCatalog]);

  const stockCategories = useMemo(() => new Set(catalogs[distributorId]?.categories ?? []), [catalogs, distributorId]);
  const fallbackImages = useMemo(() => Object.fromEntries(SEARCH_CATEGORIES.map((cat) => [cat.label, cat.img])), []);
  const categories = (config?.categories.filter((cat) => cat.showInSearch).map((cat) => ({
    label: cat.name,
    img: cat.imageUrl || fallbackImages[cat.name] || SEARCH_CATEGORIES[0].img,
  })) ?? SEARCH_CATEGORIES).filter((cat) => stockCategories.has(cat.label));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const found = await api.searchProducts(query, distributorId);
      setResults(found);
      setLoading(false);
    }, 120);
    return () => clearTimeout(t);
  }, [query, distributorId]);

  return (
    <div className="flex-1 flex flex-col bg-page min-h-0">
      <div className="p-3 flex items-center gap-2.5 border-b border-border bg-card">
        <button type="button" onClick={() => goBack(navigate)} className="size-11 rounded-[10px] bg-fill text-accent font-bold" aria-label="بازگشت">‹</button>
        <div className="flex-1 flex items-center gap-2 bg-surface-gray rounded-xl px-3 min-h-11">
          <IconSearch />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`جستجو در ${distributor?.name ?? "شرکت انتخاب‌شده"}`} className="flex-1 bg-transparent outline-none min-h-11" />
          {query && <button type="button" onClick={() => setQuery("")} className="size-11" aria-label="پاک کردن"><IconX size={16} /></button>}
        </div>
      </div>
      {query.trim() ? (
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 space-y-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          )}
          {!loading && results.length === 0 && (
            <EmptyState
              icon={<IlluSearch />}
              title="در این شرکت پیدا نشد"
              body={`${distributor?.name ?? "شرکت انتخاب‌شده"} این کالا را موجود ندارد.`}
            />
          )}
          {!loading && results.map((p) => (
            <button key={p.id} type="button" onClick={() => navigate(`/distributors/${distributorId}?q=${encodeURIComponent(p.name)}`)} className="w-full flex items-center gap-3 px-5 py-3 border-b border-border bg-card">
              <div className="flex-1 text-right">
                <div className="font-bold text-[13px]">{p.name}</div>
                <div className="text-[11px] text-text-secondary">{p.brand} · {p.sku} · {toFaNum(p.unitsPerCarton)} عدد / کارتن</div>
                <div className="font-extrabold text-accent text-[13px]">{toFaNum(p.price)} تومان / کارتن</div>
              </div>
              <ProductImage src={p.img} alt={p.name} className="w-[60px] h-[60px] rounded-[10px]" />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-[12px] text-text-secondary mb-4">نتایج فقط از موجودی {distributor?.name ?? "شرکت انتخاب‌شده"} است.</p>
          <h2 className="font-extrabold mb-3">جستجوهای پرطرفدار</h2>
          <div className="flex flex-wrap gap-2 justify-end mb-6">
            {TRENDING.map((t) => (
              <button key={t} type="button" onClick={() => setQuery(t)} className="min-h-11 px-3.5 rounded-full border border-border bg-card text-[13px] font-semibold">{t}</button>
            ))}
          </div>
          <h2 className="font-extrabold mb-3">دسته‌بندی‌های این شرکت</h2>
          {categories.length === 0 ? (
            <p className="text-[13px] text-text-secondary">برای این شرکت دسته‌بندی موجود نیست.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {categories.map((cat) => (
                <button key={cat.label} type="button" onClick={() => navigate(`/category/${encodeURIComponent(cat.label)}`)} className="rounded-2xl">
                  <span className="block bg-card border border-border rounded-2xl overflow-hidden">
                    <span className="text-[11px] font-bold p-2 block">{cat.label}</span>
                    <img src={cat.img} alt={cat.label} className="aspect-square w-full object-cover" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
