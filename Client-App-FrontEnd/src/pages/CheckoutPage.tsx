import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DeliverySlotSheet from "@/components/catalog/DeliverySlotSheet";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import Button from "@/components/ui/Button";
import ProductImage from "@/components/ui/ProductImage";
import { applyCoupon } from "@/lib/coupon";
import { toFaNum } from "@/lib/format";
import { getDistributor } from "@/lib/distributors";
import { api } from "@/services/client";
import { useAppStore, useCartMeta } from "@/store/useAppStore";

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { items, total, minMet, minOrder } = useCartMeta();
  const addresses = useAppStore((s) => s.addresses);
  const selectedAddressId = useAppStore((s) => s.selectedAddressId);
  const distributorId = useAppStore((s) => s.distributorId);
  const distributors = useAppStore((s) => s.distributors);
  const deliverySlot = useAppStore((s) => s.deliverySlot);
  const setDeliverySlot = useAppStore((s) => s.setDeliverySlot);
  const couponCode = useAppStore((s) => s.couponCode);
  const applyCouponCode = useAppStore((s) => s.applyCouponCode);
  const clearCoupon = useAppStore((s) => s.clearCoupon);
  const cityMismatch = useAppStore((s) => s.cityMismatch);
  const handleMarketplaceError = useAppStore((s) => s.handleMarketplaceError);
  const address = addresses.find((a) => a.id === selectedAddressId) ?? addresses[0];
  const dist = getDistributor(distributorId, distributors);
  const savedSlot = deliverySlot?.distributorId === distributorId ? deliverySlot : null;
  const [calOpen, setCalOpen] = useState(false);
  const [date, setDate] = useState<string | null>(savedSlot?.label ?? null);
  const [couponInput, setCouponInput] = useState(couponCode ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const coupon = couponCode ? applyCoupon(couponCode, total, distributorId) : null;
  const discount = coupon?.ok ? coupon.amount : 0;
  const payable = Math.max(0, total - discount);

  useEffect(() => {
    if (!savedSlot) setCalOpen(true);
  }, [savedSlot]);

  const pay = async () => {
    if (!minMet) { setError(`حداقل سفارش ${toFaNum(minOrder)} تومان است`); return; }
    if (!date) { setError("زمان تحویل را انتخاب کنید"); setCalOpen(true); return; }
    if (!address) { setError("آدرس تحویل مشخص نیست"); return; }
    if (cityMismatch) { setError("شرکت پخش اصلی این شهر را پوشش نمی‌دهد"); return; }
    setBusy(true);
    try {
      const payment = await api.createPayment("order", payable, {
        deliveryDate: date,
        discount,
        items,
        distributorId,
        addressLabel: address.fullAddress,
        addressId: address.id,
        deliveryDay: savedSlot?.dayKey,
        deliveryTime: savedSlot?.time,
        couponCode: couponCode ?? undefined,
      });
      navigate(`/pay/${payment.id}`);
    } catch (err) {
      if (handleMarketplaceError(err)) {
        setBusy(false);
        return;
      }
      setError(err instanceof Error ? err.message : "ثبت سفارش ناموفق بود");
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative bg-page">
      {busy && <BrandedWaitScreen overlay />}
      {calOpen && dist && (
        <DeliverySlotSheet
          distributorId={dist.id}
          fee={dist.deliveryFee}
          saved={savedSlot}
          onClose={() => setCalOpen(false)}
          onSave={(slot) => {
            setDeliverySlot(slot);
            setDate(slot.label);
            setCalOpen(false);
            setError("");
          }}
        />
      )}
      <div className="bg-card text-accent px-5 py-4 text-center border-b border-border">
        <div className="font-extrabold text-[17px]">بررسی نهایی</div>
        <div className="text-[11px] text-secondary">{dist?.name}</div>
        <div className="text-[11px] text-text-secondary mt-1">سفارش نمایشی است و پولی کسر نمی‌شود</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-28 flex flex-col gap-3.5" inert={busy || undefined}>
        <div className="bg-card rounded-[18px] border border-border p-4">
          <div className="flex justify-between mb-2">
            <button type="button" onClick={() => navigate("/addresses")} className="text-[13px] font-bold text-accent min-h-11">تغییر آدرس</button>
            <span className="font-extrabold">آدرس تحویل</span>
          </div>
          <p className="text-[12px] text-text-secondary leading-7">{address?.fullAddress ?? "آدرسی انتخاب نشده"}</p>
        </div>
        <div className="bg-card rounded-[18px] border border-border p-4">
          <div className="font-extrabold mb-3 text-right">زمان ارسال (الزامی)</div>
          {date ? (
            <div className="flex justify-between bg-brand-tint rounded-xl p-3 items-center min-h-11">
              <button type="button" onClick={() => setCalOpen(true)} className="text-xs text-accent min-h-11">تغییر</button>
              <span className="font-extrabold text-accent">{date}</span>
            </div>
          ) : (
            <button type="button" onClick={() => setCalOpen(true)} className="w-full min-h-[50px] rounded-xl border-2 border-dashed border-secondary bg-brand-tint text-accent font-bold">انتخاب تاریخ و ساعت تحویل</button>
          )}
        </div>
        <div className="bg-card rounded-[18px] border border-border p-4">
          <div className="font-extrabold mb-3 text-right">کد تخفیف</div>
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder="مثلا VISIT12"
              className="flex-1 min-h-11 rounded-xl bg-fill px-3 text-[13px] outline-none"
              dir="ltr"
            />
            {couponCode ? (
              <button type="button" onClick={() => { clearCoupon(); setCouponInput(""); }} className="min-h-11 px-3 text-[13px] text-error">حذف</button>
            ) : (
              <button type="button" onClick={() => applyCouponCode(couponInput)} className="min-h-11 px-3 rounded-xl bg-accent text-inverse text-[13px] font-semibold">اعمال</button>
            )}
          </div>
          {coupon?.ok && <p className="text-[12px] text-accent mt-2">{coupon.title} · {toFaNum(coupon.amount)} تومان</p>}
        </div>
        <div className="bg-card rounded-[18px] border border-border p-4">
          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-3 py-2">
              <ProductImage src={i.img} alt={i.name} className="size-11 rounded-xl" />
              <span className="flex-1 text-[13px] line-clamp-1">{i.name} × {toFaNum(i.qty)} کارتن</span>
              <span className="font-bold text-[13px]">{toFaNum(i.price * i.qty)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-2 border-t border-border text-[13px]">
            <span className={discount ? "text-success" : "text-text-secondary"}>{discount ? `− ${toFaNum(discount)}` : "۰"}</span>
            <span>تخفیف کد</span>
          </div>
          <div className="flex justify-between pt-2 font-black">
            <span>{toFaNum(payable)} تومان</span>
            <span>قابل پرداخت</span>
          </div>
        </div>
        {cityMismatch && (
          <p className="text-[13px] text-error bg-fill rounded-[12px] px-3 py-2">
            شرکت پخش اصلی این شهر را پوشش نمی‌دهد. آدرس را عوض کنید یا اشتراک حرفه‌ای بگیرید.
          </p>
        )}
        {error && <p className="text-error text-sm">{error}</p>}
      </div>
      <div className="absolute bottom-0 inset-x-0 z-10 bg-card border-t border-border p-4 shadow-floating">
        <Button loading={busy} onClick={pay}>ثبت سفارش نمایشی</Button>
      </div>
    </div>
  );
}
