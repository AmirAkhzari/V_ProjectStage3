import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { IconSearch } from "@/components/icons";
import DealTile from "@/components/catalog/DealTile";
import ProductSheet from "@/components/catalog/ProductSheet";
import { productToCartItem } from "@/data/catalog";
import type { Product } from "@/types";
import { goBack } from "@/lib/navigation";
import { toFaNum } from "@/lib/format";
import { getDistributor } from "@/lib/distributors";
import { useAppStore, useCartMeta } from "@/store/useAppStore";

export default function CategoryPage() {
  const { name = "نوشیدنی" } = useParams();
  const categoryName = decodeURIComponent(name);
  const navigate = useNavigate();
  const distributorId = useAppStore((s) => s.distributorId);
  const distributors = useAppStore((s) => s.distributors);
  const catalogs = useAppStore((s) => s.catalogs);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const addItem = useAppStore((s) => s.addItem);
  const inc = useAppStore((s) => s.inc);
  const distributor = getDistributor(distributorId, distributors);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);

  useEffect(() => {
    void loadCatalog(distributorId);
  }, [distributorId, loadCatalog]);

  const stockCategories = catalogs[distributorId]?.categories ?? [];
  const catalog = useMemo(() => {
    return (catalogs[distributorId]?.products ?? []).filter((product) => categoryName === "همه" || product.category === categoryName);
  }, [catalogs, distributorId, categoryName]);
  const { items, qty, total } = useCartMeta();
  const counts = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i.qty])), [items]);
  const isOos = (product: Product) => product.available === false;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-page relative">
      {openProduct && (
        <ProductSheet
          product={openProduct}
          cartTotal={total}
          isOos={isOos(openProduct)}
          onClose={() => setOpenProduct(null)}
          onAdd={(count) => {
            if (isOos(openProduct)) return;
            if (counts[openProduct.id]) {
              for (let i = 0; i < count; i++) inc(openProduct.id);
            } else {
              addItem(productToCartItem(openProduct, count));
            }
            setOpenProduct(null);
          }}
        />
      )}
      <div className="bg-card border-b border-border">
        <div className="px-4 pt-3 flex items-center gap-2.5">
          <button type="button" onClick={() => goBack(navigate)} className="size-11 rounded-[10px] bg-fill font-bold text-accent" aria-label="بازگشت">‹</button>
          <button type="button" onClick={() => navigate("/search")} className="flex-1 min-h-11 flex items-center gap-2 bg-surface-gray rounded-xl px-3 text-text-secondary text-[13px]">
            <IconSearch size={16} /> جستجو در {distributor?.name ?? "شرکت انتخاب‌شده"}
          </button>
        </div>
        <div className="flex overflow-x-auto no-scrollbar px-1 mt-1">
          {stockCategories.map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => navigate(`/category/${encodeURIComponent(sub)}`)}
              className={`px-4 min-h-11 whitespace-nowrap text-sm ${sub === categoryName ? "font-extrabold border-b-[3px] border-accent" : "text-secondary"}`}
            >
              {sub}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pb-24">
        {catalog.length === 0 ? (
          <p className="text-center text-[13px] text-text-secondary pt-10 px-6">
            {categoryName} در موجودی {distributor?.name ?? "این شرکت"} نیست. دسته دیگری را انتخاب کنید یا به فروشگاه بروید.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-2 gap-y-5">
            {catalog.map((p) => {
              const oos = isOos(p);
              return (
                <DealTile
                  key={p.id}
                  product={p}
                  count={counts[p.id] ?? 0}
                  disabled={oos}
                  onOpen={() => setOpenProduct(p)}
                  onAdd={() => { if (!oos) addItem(productToCartItem(p)); }}
                />
              );
            })}
          </div>
        )}
      </div>
      {qty > 0 && (
        <div className="absolute bottom-0 inset-x-0 z-10 bg-card border-t border-border p-3 flex items-center justify-between">
          <button type="button" onClick={() => navigate("/cart")} className="bg-accent text-inverse rounded-xl min-h-11 px-5 text-[13px] font-bold">مشاهده سبد</button>
          <div className="text-right text-[13px] font-bold">{toFaNum(qty)} کارتن در سبد</div>
        </div>
      )}
    </div>
  );
}
