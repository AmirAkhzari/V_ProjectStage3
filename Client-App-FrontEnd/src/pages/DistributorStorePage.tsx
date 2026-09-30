import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import DealTile from "@/components/catalog/DealTile";
import DeliverySlotSheet from "@/components/catalog/DeliverySlotSheet";
import ProductSheet from "@/components/catalog/ProductSheet";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import ProBadge from "@/components/ui/ProBadge";
import Spinner from "@/components/ui/Spinner";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconInfo, IconSearch } from "@/components/icons";
import { productToCartItem } from "@/data/catalog";
import { storeSlotNotice } from "@/lib/delivery";
import { goBack } from "@/lib/navigation";
import { toFaDigits, toFaNum, normalizePersian } from "@/lib/format";
import { distributorServesCity, getDistributor, userCity } from "@/lib/distributors";
import { canAccessDistributor } from "@/lib/plan";
import type { Product } from "@/types";
import { useAppStore, useCartMeta } from "@/store/useAppStore";

const START_SECONDS = 37 * 60 + 51;

export default function DistributorStorePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const distributors = useAppStore((s) => s.distributors);
  const catalogs = useAppStore((s) => s.catalogs);
  const ensureDistributor = useAppStore((s) => s.ensureDistributor);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const distributor = getDistributor(id, distributors);
  const { items, qty, total, minMet, minOrder } = useCartMeta();
  const addItem = useAppStore((s) => s.addItem);
  const distributorId = useAppStore((s) => s.distributorId);
  const setDistributor = useAppStore((s) => s.setDistributor);
  const setToast = useAppStore((s) => s.setToast);
  const rememberStore = useAppStore((s) => s.rememberStore);
  const deliverySlot = useAppStore((s) => s.deliverySlot);
  const setDeliverySlot = useAppStore((s) => s.setDeliverySlot);
  const addresses = useAppStore((s) => s.addresses);
  const selectedAddressId = useAppStore((s) => s.selectedAddressId);
  const [ready, setReady] = useState(Boolean(distributor && catalogs[id]));
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sheet, setSheet] = useState<"info" | "switch" | "delivery" | "product" | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingQty, setPendingQty] = useState(1);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [remain, setRemain] = useState(START_SECONDS);
  const [switching, setSwitching] = useState(false);

  const plan = useAppStore((s) => s.plan);
  const primaryDistributorId = useAppStore((s) => s.primaryDistributorId);
  const city = userCity(addresses, selectedAddressId);
  const servesCity = distributor ? distributorServesCity(distributor, city) : false;
  const selected = distributor?.id === distributorId;
  const full = distributor?.status === "full";
  const addBlocked = !distributor || full || (Boolean(city) && !servesCity);
  const selectedSlot = deliverySlot?.distributorId === distributor?.id ? deliverySlot : null;
  const marketplaceLocked = Boolean(id) && !canAccessDistributor(plan, primaryDistributorId, id);

  useEffect(() => {
    if (distributor) rememberStore(distributor.id);
  }, [distributor, rememberStore]);

  useEffect(() => {
    if (marketplaceLocked) return;
    let live = true;
    void (async () => {
      const found = await ensureDistributor(id);
      if (!live) return;
      if (!found) {
        setMissing(true);
        return;
      }
      await loadCatalog(id, true);
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [id, ensureDistributor, loadCatalog, marketplaceLocked]);

  useEffect(() => {
    const timer = window.setInterval(() => setRemain((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const catalog = catalogs[id]?.products ?? [];
  const categories = catalogs[id]?.categories ?? [];
  const deals = useMemo(() => catalog.filter((product) => product.disc).sort((a, b) => (b.disc ?? 0) - (a.disc ?? 0)), [catalog]);
  const counts = useMemo(() => Object.fromEntries(items.map((item) => [item.id, item.qty])), [items]);
  const remaining = Math.max(0, minOrder - total);
  const needle = normalizePersian(query.trim());

  const visible = (product: Product) => {
    if (!needle) return true;
    return [product.name, product.brand, product.category, product.subCategory].some((value) => normalizePersian(value).includes(needle));
  };

  const visibleDeals = deals.filter(visible);

  const commitAdd = async (product: Product, clearCart = false, qty = pendingQty) => {
    if (!distributor) return;
    const switchingNow = distributor.id !== distributorId;
    if (switchingNow) setSwitching(true);
    try {
      if (switchingNow && !setDistributor(distributor.id, clearCart)) return;
      addItem(productToCartItem(product, qty));
      if (switchingNow) await loadCatalog(distributor.id, true);
      setPendingProduct(null);
      setPendingQty(1);
      setOpenProduct(null);
      setSheet(null);
    } finally {
      if (switchingNow) setSwitching(false);
    }
  };

  const tryAdd = (product: Product, qty = 1) => {
    if (!distributor) return;
    if (product.available === false) {
      setToast("این کالا فعلاً موجود نیست");
      return;
    }
    if (full) {
      setToast("ظرفیت امروز این شرکت پخش تکمیل شده");
      return;
    }
    if (city && !servesCity) {
      setToast("این شرکت پخش در شهر شما فعال نیست");
      return;
    }
    if (distributor.id !== distributorId && items.length) {
      setPendingProduct(product);
      setPendingQty(qty);
      setOpenProduct(null);
      setSheet("switch");
      return;
    }
    commitAdd(product, false, qty);
  };

  if (marketplaceLocked) return <Navigate to="/subscription" replace />;
  if (missing) return <Navigate to="/" replace />;
  if (!distributor || !ready) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-secondary">
        <Spinner className="size-7 text-accent" />
        <span className="text-sm">در حال بارگذاری فروشگاه...</span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-page">
      {switching && <BrandedWaitScreen overlay />}
      {sheet === "info" && (
        <div className="absolute inset-0 z-50 bg-ink/55 flex flex-col justify-end" onClick={() => setSheet(null)}>
          <div className="bg-card rounded-t-[20px] p-6 sheet-up" dir="rtl" onClick={(event) => event.stopPropagation()}>
            <div className="font-semibold text-center text-[17px] mb-4">مشخصات شرکت پخش</div>
            <dl className="space-y-3 text-[14px]">
              <Row label="نام" value={distributor.name} />
              <Row label="محدوده" value={distributor.area || "—"} />
              <Row label="شهرهای پوشش" value={distributor.cities.join("، ")} />
              <Row label="امتیاز" value={toFaNum(distributor.rating)} />
              <Row label="زمان ارسال" value={`تا ${toFaNum(distributor.deliveryMins)} دقیقه`} />
              <Row label="حداقل سبد" value={`${toFaNum(distributor.minBasket)} تومان`} />
              <Row label="هزینه ارسال" value={distributor.deliveryFee === "free" ? "رایگان" : `${toFaNum(distributor.deliveryFee)} تومان`} />
              <Row label="وضعیت" value={full ? "ظرفیت امروز تکمیل" : "فعال"} />
            </dl>
            <button type="button" onClick={() => setSheet(null)} className="w-full h-12 mt-5 text-text-secondary">بستن</button>
          </div>
        </div>
      )}

      {sheet === "switch" && pendingProduct && (
        <div className="absolute inset-0 z-50 bg-ink/55 flex flex-col justify-end" onClick={() => { setSheet(null); setPendingProduct(null); }}>
          <div className="bg-card rounded-t-[20px] p-6 sheet-up" onClick={(event) => event.stopPropagation()}>
            <div className="font-semibold text-center text-[17px] mb-3">تغییر شرکت پخش</div>
            <p className="text-[13px] text-text-secondary leading-7 mb-4">سبد خرید مربوط به شرکت پخش دیگری است. قیمت‌ها با این شرکت هماهنگ می‌شوند یا سبد خالی می‌شود.</p>
            <button type="button" onClick={() => commitAdd(pendingProduct)} className="w-full h-[50px] rounded-[14px] bg-accent text-inverse font-semibold mb-2">اعمال شرکت جدید و افزودن</button>
            <button type="button" onClick={() => commitAdd(pendingProduct, true)} className="w-full h-12 rounded-[14px] text-error font-semibold mb-2">خالی کردن سبد و افزودن</button>
            <button type="button" onClick={() => { setSheet(null); setPendingProduct(null); }} className="w-full h-11 text-text-secondary">انصراف</button>
          </div>
        </div>
      )}

      {sheet === "product" && openProduct && (
        <ProductSheet
          product={openProduct}
          seller={distributor.name}
          cartTotal={total}
          disabled={addBlocked}
          onClose={() => { setSheet(null); setOpenProduct(null); }}
          onAdd={(count) => tryAdd(openProduct, count)}
        />
      )}

      {sheet === "delivery" && (
        <DeliverySlotSheet
          distributorId={distributor.id}
          fee={distributor.deliveryFee}
          saved={selectedSlot}
          onClose={() => setSheet(null)}
          onSave={(slot) => {
            setDeliverySlot(slot);
            setSheet(null);
          }}
        />
      )}

      <div className="relative flex items-center justify-between px-2 py-1.5 shrink-0" dir="rtl">
        <button type="button" onClick={() => goBack(navigate)} className="size-11 flex items-center justify-center text-accent" aria-label="بازگشت">
          <IconChevronRight />
        </button>
        <div className={`size-12 rounded-[14px] text-[10px] font-semibold flex items-center justify-center text-center whitespace-pre-line ${distributor.logoTone === "accent" ? "bg-accent text-inverse" : "bg-fill text-accent"}`}>
          {distributor.logoText}
        </div>
        <div className="flex items-center">
          <button type="button" onClick={() => setSheet("delivery")} className="size-11 flex items-center justify-center text-accent" aria-label="انتخاب زمان تحویل">
            <IconCalendar />
          </button>
          <button type="button" onClick={() => setSheet("info")} className="size-11 flex items-center justify-center text-accent" aria-label="مشخصات">
            <IconInfo />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        <header className="px-4 pt-1 pb-4 text-center" dir="rtl">
          <div className="flex items-center justify-center gap-1.5">
            {distributor.pro && <ProBadge />}
            <h1 className="text-[20px] font-bold">{distributor.name}{distributor.area ? ` ${distributor.area}` : ""}</h1>
          </div>
          {distributor.pro && <p className="text-[11px] text-text-secondary mt-1">Pro یعنی ارسال سریع‌تر و اولویت ظرفیت نسبت به شرکت‌های عادی</p>}
          {distributor.isPrimary || distributor.id === primaryDistributorId ? <div className="text-[11px] text-accent mt-1">شرکت پخش اصلی</div> : null}
          {selected && <div className="text-[11px] text-accent mt-1">انتخاب فعلی</div>}
          <p className="text-[12px] text-text-secondary mt-1.5">
            ★ {toFaNum(distributor.rating)} | تا {toFaNum(distributor.minBasket)} تومان | {toFaNum(distributor.deliveryMins)} دقیقه
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="text-[11px] bg-fill rounded-full px-2.5 py-1">ارسال شرکت پخش</span>
            <span className="text-[11px] bg-fill rounded-full px-2.5 py-1">تحویل در فروشگاه</span>
          </div>
          {full && (
            <p className="mt-3 text-[12px] text-error bg-fill rounded-[12px] px-3 py-2">ظرفیت امروز این شرکت تکمیل شده؛ می‌توانید کالاها را ببینید ولی فعلاً قابل انتخاب نیست.</p>
          )}
          {city && !servesCity && (
            <p className="mt-3 text-[12px] text-error bg-fill rounded-[12px] px-3 py-2">این شرکت پخش در شهر شما فعال نیست.</p>
          )}
          {!full && servesCity && (
            <button type="button" onClick={() => setSheet("delivery")} className="mt-3 text-[12px] text-text-secondary bg-fill rounded-[12px] px-3 py-2 w-full">
              {selectedSlot ? storeSlotNotice(selectedSlot) : `برای ثبت سفارش باید زمان تحویل را انتخاب کنید. بدون انتخاب بازه، تسویه ممکن نیست. زمان پیشنهادی تا ${toFaNum(distributor.deliveryMins)} دقیقه پس از تأیید است.`}
            </button>
          )}
        </header>

        <div className="px-4">
          <label className="w-full bg-fill rounded-full px-4 py-2.5 flex items-center gap-2.5 text-secondary text-[15px]">
            <IconSearch />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`جستجو در ${distributor.name} ...`}
              className="flex-1 bg-transparent outline-none text-text-primary placeholder:text-secondary min-w-0"
            />
          </label>
        </div>

        <section className="px-4 pt-4">
          <div className="w-full bg-card rounded-[16px] px-4 py-3.5 flex items-center justify-between text-right" dir="rtl">
            <div>
              <div className="font-semibold text-[15px]">{distributor.deliveryFee === "free" ? "ارسال رایگان" : `ارسال ${toFaNum(distributor.deliveryFee)} تومان`}</div>
              <div className="text-[12px] text-text-secondary mt-0.5">
                {distributor.pro ? "ویژه Pro: ارسال سریع‌تر، " : ""}حداقل خرید {toFaNum(Math.round(distributor.minBasket / 1000))} هزار تومان
              </div>
            </div>
            <IconChevronLeft />
          </div>
        </section>

        {visibleDeals.length > 0 && (
          <section className="px-4 pt-6" dir="rtl">
            <div className="rounded-[16px] bg-accent text-inverse px-3 py-2.5 mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold">ویژه خرید اول!</h2>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums" aria-label="شمارنده تخفیف">
                <TimeBox value={Math.floor(remain / 3600)} />
                <span>:</span>
                <TimeBox value={Math.floor((remain % 3600) / 60)} />
                <span>:</span>
                <TimeBox value={remain % 60} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-5">
              {visibleDeals.map((product) => (
                <DealTile
                  key={product.id}
                  product={product}
                  count={selected ? (counts[product.id] ?? 0) : 0}
                  disabled={addBlocked || product.available === false}
                  onOpen={() => { setOpenProduct(product); setSheet("product"); }}
                  onAdd={() => { if (product.available !== false) tryAdd(product); }}
                />
              ))}
            </div>
          </section>
        )}

        {categories.map((category) => {
          const products = catalog.filter((product) => product.category === category && visible(product) && !visibleDeals.some((deal) => deal.id === product.id));
          if (!products.length) return null;
          return (
            <section key={category} className="px-4 pt-8" dir="rtl">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-[18px] font-bold">{category}</h2>
                <span className="text-[13px] text-text-secondary">{toFaNum(products.length)} کالا</span>
              </div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-5">
                {products.map((product) => (
                  <DealTile
                    key={product.id}
                    product={product}
                    count={selected ? (counts[product.id] ?? 0) : 0}
                    disabled={addBlocked || product.available === false}
                    onOpen={() => { setOpenProduct(product); setSheet("product"); }}
                    onAdd={() => { if (product.available !== false) tryAdd(product); }}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {needle && !catalog.some(visible) && (
          <p className="text-center text-[13px] text-text-secondary px-4 pt-10">کالایی با این جستجو در این شرکت پیدا نشد.</p>
        )}
      </div>

      {qty > 0 && selected && (
        <div className="shrink-0 bg-card/80 backdrop-blur-xl border-t border-separator px-4 py-2.5">
          <button type="button" onClick={() => navigate("/cart")} className="w-full flex items-center justify-between">
            <span className="text-[13px] font-semibold">{toFaNum(qty)} کالا · {toFaNum(total)} تومان</span>
            <span className="text-[13px]">{minMet ? "حداقل سفارش تامین شد" : `${toFaNum(remaining)} تومان تا ثبت`}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function TimeBox({ value }: { value: number }) {
  return (
    <span className="min-w-[28px] h-7 px-1 rounded-md bg-inverse/15 flex items-center justify-center">
      {toFaDigits(String(value).padStart(2, "0"))}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-secondary shrink-0">{label}</dt>
      <dd className="font-medium text-left">{value}</dd>
    </div>
  );
}
