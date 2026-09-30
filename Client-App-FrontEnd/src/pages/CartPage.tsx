import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { IconMinus, IconPlus, IconTrash } from "@/components/icons";
import { productToCartItem } from "@/data/catalog";
import { toFaNum } from "@/lib/format";
import { getDistributor } from "@/lib/distributors";
import { useAppStore, useCartMeta } from "@/store/useAppStore";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { IlluCart } from "@/components/illustrations";
import ProductImage from "@/components/ui/ProductImage";
import Price from "@/components/ui/Price";

export default function CartPage() {
  const navigate = useNavigate();
  const { items, total, minMet, qty, minOrder } = useCartMeta();
  const inc = useAppStore((s) => s.inc);
  const dec = useAppStore((s) => s.dec);
  const remove = useAppStore((s) => s.remove);
  const addItem = useAppStore((s) => s.addItem);
  const distId = useAppStore((s) => s.distributorId);
  const distributors = useAppStore((s) => s.distributors);
  const catalogs = useAppStore((s) => s.catalogs);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const cityMismatch = useAppStore((s) => s.cityMismatch);
  const dist = getDistributor(distId, distributors);

  useEffect(() => {
    if (distId) void loadCatalog(distId);
  }, [distId, loadCatalog]);

  const prev = items.length > 0
    ? (catalogs[distId]?.products ?? []).filter((p) => p.lastOrder).slice(0, 4)
    : [];
  const progress = Math.min(total / minOrder, 1);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-page">
      <div className="bg-card px-5 py-4 border-b border-separator">
        <div className="text-[11px] text-secondary">سبد خرید از</div>
        <div className="text-lg font-extrabold text-accent">{dist?.name ?? "شرکت پخش"}</div>
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {items.length === 0 && (
          <EmptyState icon={<IlluCart />} title="سبد خرید شما خالی است" body="کالای مورد نظر را از فروشگاه شرکت پخش انتخاب کنید" />
        )}
        {items.length > 0 && (
          <div className="p-4">
            {cityMismatch && (
              <div className="bg-card rounded-[10px] p-3.5 mb-3.5 text-[13px] text-error leading-7">
                شرکت پخش اصلی این شهر را پوشش نمی‌دهد. آدرس را عوض کنید یا اشتراک حرفه‌ای بگیرید.
              </div>
            )}
            {!minMet && (
              <div className="bg-card rounded-[10px] p-3.5 mb-3.5">
                <div className="text-[12px] text-text-secondary mb-2">تا حداقل سفارش: <strong className="text-accent">{toFaNum(minOrder - total)}</strong> تومان مانده</div>
                <div className="h-2 rounded-full bg-brand-tint overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            )}
            <div className="bg-card rounded-[10px] overflow-hidden">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3.5 border-b border-separator last:border-0">
                  <ProductImage src={item.img} alt={item.name} className="w-[68px] h-[68px] rounded-xl" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold line-clamp-2">{item.name}</div>
                    <div className="text-[11px] text-text-secondary">{toFaNum(item.unitsPerCarton)} عدد / کارتن</div>
                    <Price value={item.price * item.qty} size="sm" />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <button type="button" onClick={() => inc(item.id)} className="size-11 rounded-[10px] bg-fill text-accent flex items-center justify-center" aria-label="افزایش کارتن"><IconPlus size={16} /></button>
                    <div className="text-center font-extrabold text-[15px]">{toFaNum(item.qty)}<div className="text-[9px] font-normal text-text-secondary">کارتن</div></div>
                    <button type="button" onClick={() => (item.qty > 1 ? dec(item.id) : remove(item.id))} className="size-11 rounded-[10px] bg-fill text-error flex items-center justify-center" aria-label="کاهش کارتن">
                      {item.qty > 1 ? <IconMinus color="#E53E3E" /> : <IconTrash />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {prev.length > 0 && (
          <div className="px-4 pb-4">
            <div className="flex justify-between mb-3 items-center min-h-11">
              <button type="button" onClick={() => navigate(dist ? `/distributors/${dist.id}` : "/")} className="text-xs font-semibold text-accent">مشاهده فروشگاه</button>
              <span className="font-extrabold">خریدهای قبلی همین شرکت</span>
            </div>
            {prev.map((p) => (
              <div key={p.id} className="bg-card rounded-[10px] p-3 flex items-center gap-3 mb-2.5">
                <ProductImage src={p.img} alt={p.name} className="w-14 h-14 rounded-[10px]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold line-clamp-1">{p.name}</div>
                  <div className="text-[11px] text-text-secondary">× {toFaNum(p.unitsPerCarton)} عدد / کارتن</div>
                  <div className="text-[13px] font-extrabold text-accent">{toFaNum(p.price)} تومان / کارتن</div>
                </div>
                <button type="button" onClick={() => addItem(productToCartItem(p))} className="size-11 rounded-[10px] flex items-center justify-center bg-accent text-inverse" aria-label="افزودن کارتن">
                  <IconPlus size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-card border-t border-border p-4">
        {items.length > 0 && (
          <div className="flex justify-between mb-3">
            <div className="text-xl font-black text-accent">{toFaNum(total)} <span className="text-xs font-normal">تومان</span></div>
            <span className="text-[13px] text-text-secondary">جمع کل ({toFaNum(qty)} کارتن)</span>
          </div>
        )}
        <Button
          disabled={items.length > 0 && !cityMismatch && !minMet}
          onClick={() => {
            if (!items.length) navigate(dist ? `/distributors/${dist.id}` : "/");
            else if (cityMismatch) navigate("/subscription");
            else if (minMet) navigate("/checkout");
          }}
        >
          {!items.length ? "رفتن به فروشگاه" : cityMismatch ? "رفع محدودیت شهر" : minMet ? "ادامه فرآیند خرید" : "تکمیل سبد تا حداقل سفارش"}
        </Button>
      </div>
    </div>
  );
}
