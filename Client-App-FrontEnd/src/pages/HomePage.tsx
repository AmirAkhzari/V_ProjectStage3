import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DealTile from "@/components/catalog/DealTile";
import ProductSheet from "@/components/catalog/ProductSheet";
import { DISTRIBUTORS, HOME_BANNERS, productToCartItem } from "@/data/catalog";
import { catalogSections } from "@/lib/catalogSections";
import { type PriceCompareRow } from "@/lib/deals";
import { toFaNum } from "@/lib/format";
import { cityIdFromName, distributorsInCity, getDistributor, userCity } from "@/lib/distributors";
import { canBrowseMarketplace, canComparePrices } from "@/lib/plan";
import { api } from "@/services/client";
import { useAppStore, useCartMeta } from "@/store/useAppStore";
import { IconSearch } from "@/components/icons";
import type { Product } from "@/types";

export default function HomePage() {
  const navigate = useNavigate();
  const { items, qty, total, minMet, minOrder } = useCartMeta();
  const distributorId = useAppStore((s) => s.distributorId);
  const addresses = useAppStore((s) => s.addresses);
  const selectedAddressId = useAppStore((s) => s.selectedAddressId);
  const addItem = useAppStore((s) => s.addItem);
  const inc = useAppStore((s) => s.inc);
  const setToast = useAppStore((s) => s.setToast);
  const distributors = useAppStore((s) => s.distributors);
  const config = useAppStore((s) => s.config);
  const plan = useAppStore((s) => s.plan);
  const primaryDistributorId = useAppStore((s) => s.primaryDistributorId);
  const catalogs = useAppStore((s) => s.catalogs);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const openPlanUpsell = useAppStore((s) => s.openPlanUpsell);
  const handleMarketplaceError = useAppStore((s) => s.handleMarketplaceError);
  const cityMismatch = useAppStore((s) => s.cityMismatch);
  const [compareOpen, setCompareOpen] = useState(false);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [compareRows, setCompareRows] = useState<PriceCompareRow[]>([]);

  const catalogId = distributorId || primaryDistributorId || "";
  const city = userCity(addresses, selectedAddressId);
  const cityDistributors = distributorsInCity(city, distributors).filter((company) => (
    canBrowseMarketplace(plan) || company.id === primaryDistributorId || !primaryDistributorId
  ));
  const selectedDist = getDistributor(catalogId, distributors);
  const remaining = Math.max(0, minOrder - total);
  const comparables = cityDistributors.filter((company) => company.status === "active");
  const cityHasMarketplace = distributorsInCity(city, DISTRIBUTORS).filter((company) => company.status === "active").length >= 2;
  const banners = config?.banners.length ? config.banners : HOME_BANNERS;
  const catalog = catalogs[catalogId]?.products ?? [];
  const categories = catalogs[catalogId]?.categories ?? [];
  const deals = useMemo(
    () => catalog.filter((product) => product.disc).sort((a, b) => (b.disc ?? 0) - (a.disc ?? 0)),
    [catalog],
  );
  const sections = useMemo(
    () => catalogSections(catalog, categories, config?.categories),
    [catalog, categories, config],
  );
  const counts = useMemo(() => Object.fromEntries(items.map((item) => [item.id, item.qty])), [items]);
  const addBlocked = selectedDist?.status === "full";
  const isOos = (product: Product) => product.available === false;

  const tryAdd = (product: Product, count = 1) => {
    if (isOos(product)) return;
    if (addBlocked) {
      setToast("ظرفیت امروز این شرکت پخش تکمیل شده");
      return;
    }
    if (counts[product.id]) {
      for (let i = 0; i < count; i++) inc(product.id);
    } else {
      addItem(productToCartItem(product, count));
    }
  };

  useEffect(() => {
    if (catalogId) void loadCatalog(catalogId);
  }, [catalogId, loadCatalog]);

  useEffect(() => {
    const cityId = cityIdFromName(city, config?.cities ?? []);
    if (!cityId || !canComparePrices(plan) || comparables.length < 2) {
      setCompareRows([]);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const rows = await api.getCompare(comparables[0].id, comparables[1].id);
        if (live) setCompareRows(rows.slice(0, 6));
      } catch (err) {
        handleMarketplaceError(err);
        if (live) setCompareRows([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [city, config, distributors, plan, handleMarketplaceError]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-page">
      {openProduct && (
        <ProductSheet
          product={openProduct}
          seller={selectedDist?.name}
          cartTotal={total}
          disabled={addBlocked || isOos(openProduct)}
          isOos={isOos(openProduct)}
          onClose={() => setOpenProduct(null)}
          onAdd={(count) => {
            tryAdd(openProduct, count);
            setOpenProduct(null);
          }}
        />
      )}

      {compareOpen && comparables.length >= 2 && (
        <div className="absolute inset-0 z-40 bg-ink/55 flex flex-col justify-end" onClick={() => setCompareOpen(false)}>
          <div className="bg-card rounded-t-[20px] p-5 sheet-up max-h-[85%] overflow-y-auto" dir="rtl" onClick={(event) => event.stopPropagation()}>
            <div className="font-semibold text-center text-[17px] mb-1">مقایسه قیمت شرکت‌ها</div>
            <p className="text-[12px] text-text-secondary text-center mb-4">
              کالاهای مشترک {comparables[0].name} و {comparables[1].name}
            </p>
            {compareRows.length === 0 ? (
              <p className="text-[13px] text-text-secondary text-center py-6">کالای مشترکی برای مقایسه نیست.</p>
            ) : (
              <div className="space-y-2">
                {compareRows.map((row) => {
                  const leftWins = row.left.price < row.right.price;
                  return (
                    <div key={row.product.id} className="bg-fill rounded-[14px] p-3">
                      <div className="text-[13px] font-semibold mb-2">{row.product.name}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => navigate(`/distributors/${row.leftDistributor.id}`)} className={`rounded-[12px] p-2.5 text-right ${leftWins ? "bg-card" : ""}`}>
                          <div className="text-[11px] text-text-secondary">{row.leftDistributor.name}</div>
                          <div className="font-semibold text-[13px] mt-1">{toFaNum(row.left.price)}</div>
                        </button>
                        <button type="button" onClick={() => navigate(`/distributors/${row.rightDistributor.id}`)} className={`rounded-[12px] p-2.5 text-right ${!leftWins ? "bg-card" : ""}`}>
                          <div className="text-[11px] text-text-secondary">{row.rightDistributor.name}</div>
                          <div className="font-semibold text-[13px] mt-1">{toFaNum(row.right.price)}</div>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button type="button" onClick={() => setCompareOpen(false)} className="w-full h-12 mt-4 text-text-secondary">بستن</button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <header className="px-5 pt-3 pb-3 bg-page">
          <button type="button" onClick={() => navigate("/search")} className="w-full min-h-11 bg-fill rounded-full px-4 py-2.5 flex items-center gap-2.5 text-secondary text-[15px]">
            <IconSearch /> جستجو در {selectedDist?.name ?? "شرکت انتخاب‌شده"}
          </button>
        </header>

        <section className="pt-2" aria-label="بنرهای تبلیغاتی">
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar px-4 pb-1">
            {banners.map((banner, index) => (
              <article
                key={banner.id}
                className={`min-w-[86%] snap-center rounded-[18px] px-5 py-6 ${index % 2 === 0 ? "bg-accent text-inverse" : "bg-card text-text-primary"}`}
              >
                <div className="text-[22px] font-bold">{banner.title}</div>
                <p className={`text-[13px] mt-1.5 leading-6 ${index % 2 === 0 ? "text-inverse/70" : "text-text-secondary"}`}>{banner.subtitle}</p>
              </article>
            ))}
          </div>
        </section>

        {sections.length > 0 && (
          <section className="px-4 pt-5" dir="rtl" aria-label="دسته‌بندی محصولات">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {sections.map((section) => (
                <button
                  key={section.title}
                  type="button"
                  onClick={() => navigate(`/category/${encodeURIComponent(section.title)}`)}
                  className="shrink-0 min-h-11 px-3.5 rounded-full bg-card text-[13px] font-semibold"
                >
                  {section.title}
                </button>
              ))}
            </div>
          </section>
        )}

        {deals.length > 0 && (
          <section className="px-4 pt-6" dir="rtl">
            <div className="flex items-baseline justify-between mb-3 gap-2">
              <h2 className="text-[20px] font-bold">کالاهای تخفیف دار</h2>
              <div className="flex items-center gap-2 shrink-0">
                {(comparables.length >= 2 || cityHasMarketplace) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canComparePrices(plan)) {
                        openPlanUpsell();
                        return;
                      }
                      setCompareOpen(true);
                    }}
                    className="text-[13px] text-accent min-h-11 px-1"
                  >
                    مقایسه
                  </button>
                )}
                <span className="text-[13px] text-text-secondary">{toFaNum(deals.length)} کالا</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-5">
              {deals.map((product) => (
                <DealTile
                  key={product.id}
                  product={product}
                  count={counts[product.id] ?? 0}
                  disabled={addBlocked || isOos(product)}
                  onOpen={() => setOpenProduct(product)}
                  onAdd={() => { if (!isOos(product)) tryAdd(product); }}
                />
              ))}
            </div>
          </section>
        )}

        {sections.map((section) => (
          <section key={section.title} className="px-4 pt-8 pb-2" dir="rtl">
            <div className="flex items-baseline justify-between mb-3">
              <button type="button" onClick={() => navigate(`/category/${encodeURIComponent(section.title)}`)} className="text-right">
                <h2 className="text-[18px] font-bold">{section.title}</h2>
              </button>
              <button type="button" onClick={() => navigate(`/category/${encodeURIComponent(section.title)}`)} className="text-[13px] text-text-secondary">
                {toFaNum(section.products.length)} کالا
              </button>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-5">
              {section.products.map((product) => (
                <DealTile
                  key={product.id}
                  product={product}
                  count={counts[product.id] ?? 0}
                  disabled={addBlocked || isOos(product)}
                  onOpen={() => setOpenProduct(product)}
                  onAdd={() => { if (!isOos(product)) tryAdd(product); }}
                />
              ))}
            </div>
          </section>
        ))}

        {catalogId && catalog.length === 0 && (
          <p className="text-[13px] text-text-secondary bg-card rounded-[14px] p-4 mx-4 mt-6">
            کالایی از {selectedDist?.name ?? "شرکت پخش انتخاب‌شده"} برای نمایش نیست.
          </p>
        )}

        {cityMismatch && (
          <section className="px-4 pt-6 pb-6" dir="rtl">
            <div className="bg-card rounded-[14px] p-4 text-right">
              <div className="font-semibold text-[15px]">شرکت پخش اصلی این شهر را پوشش نمی‌دهد</div>
              <p className="text-[13px] text-text-secondary leading-7 mt-1">
                آدرس را به شهری که شرکت اصلی پوشش می‌دهد برگردانید، یا از پروفایل اشتراک حرفه‌ای بگیرید تا شرکت دیگری انتخاب کنید.
              </p>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => navigate("/addresses")} className="h-11 px-4 rounded-[12px] bg-fill text-accent text-[13px] font-semibold">تغییر آدرس</button>
                <button type="button" onClick={() => navigate("/subscription")} className="h-11 px-4 rounded-[12px] bg-accent text-inverse text-[13px] font-semibold">اشتراک حرفه‌ای</button>
              </div>
            </div>
          </section>
        )}
      </div>

      {qty > 0 && (
        <div className="shrink-0 bg-card/80 backdrop-blur-xl border-t border-separator px-4 py-2.5">
          <div className="flex justify-between text-[13px] mb-2">
            <span>{minMet ? <span className="font-medium">حداقل سفارش تامین شد</span> : <span><strong className="text-error">{toFaNum(remaining)}</strong> تومان تا ثبت سفارش</span>}</span>
            <span className="font-medium">حداقل سفارش {toFaNum(Math.min(100, Math.round((total / minOrder) * 100)))}٪</span>
          </div>
          <div className="h-1 rounded-full bg-fill overflow-hidden">
            <div className={`h-full ${minMet ? "bg-accent" : "bg-gray-5"}`} style={{ width: `${Math.min(100, (total / minOrder) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
