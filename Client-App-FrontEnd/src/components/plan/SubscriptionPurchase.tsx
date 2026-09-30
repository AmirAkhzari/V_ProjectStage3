import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import Button from "@/components/ui/Button";
import { PlanBenefits } from "@/components/plan/PlanUpsell";
import { formatPlanExpiry } from "@/lib/plan";
import { toFaNum } from "@/lib/format";
import { api } from "@/services/client";
import { useAppStore } from "@/store/useAppStore";

export default function SubscriptionPurchase() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const plan = useAppStore((s) => s.plan);
  const expiresAt = useAppStore((s) => s.subscriptionExpiresAt);
  const storePrice = useAppStore((s) => s.proMonthlyPrice);
  const refreshEntitlement = useAppStore((s) => s.refreshEntitlement);
  const setToast = useAppStore((s) => s.setToast);
  const [price, setPrice] = useState(storePrice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getSubscription().then((row) => setPrice(row.price || storePrice)).catch(() => setPrice(storePrice));
  }, [storePrice]);

  useEffect(() => {
    if (params.get("ok") === "1" || params.get("sub") === "ok") {
      setToast("اشتراک حرفه‌ای فعال شد");
      void refreshEntitlement();
      params.delete("ok");
      params.delete("sub");
      setParams(params, { replace: true });
    }
    if (params.get("fail") === "1" || params.get("sub") === "fail") {
      setError("پرداخت اشتراک ناموفق بود. مبلغی کسر نشد.");
      params.delete("fail");
      params.delete("sub");
      setParams(params, { replace: true });
    }
  }, [params, setParams, setToast, refreshEntitlement]);

  const buy = async () => {
    setBusy(true);
    setError("");
    try {
      const checkout = await api.checkoutSubscription();
      navigate(`/pay/${checkout.paymentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "شروع پرداخت ناموفق بود");
      setBusy(false);
    }
  };

  const active = plan === "pro";
  const expiryLabel = formatPlanExpiry(expiresAt);

  return (
    <div id="subscription" className="scroll-mt-4">
      {busy && <BrandedWaitScreen overlay />}
      <div className={`rounded-[22px] p-5 mb-3 ${active ? "bg-accent text-inverse" : "bg-card"}`}>
        <div className={`text-[13px] ${active ? "text-inverse/70" : "text-text-secondary"}`}>طرح فعلی</div>
        <div className="text-[25px] font-bold mt-1">{active ? "حرفه‌ای" : "رایگان"}</div>
        {active && expiryLabel ? (
          <p className="text-[13px] mt-2 text-inverse/80">تا {expiryLabel} فعال است</p>
        ) : (
          <p className={`text-[13px] mt-2 leading-7 ${active ? "text-inverse/80" : "text-text-secondary"}`}>
            با طرح رایگان فقط از شرکت پخش اصلی خودتان خرید می‌کنید.
          </p>
        )}
      </div>

      <div className="bg-card rounded-[18px] p-5 mb-3">
        <div className="font-semibold text-[17px] mb-3">با اشتراک حرفه‌ای چه می‌شود؟</div>
        <PlanBenefits />
      </div>

      <div className="bg-card rounded-[18px] p-5 mb-3 text-center">
        <div className="text-[13px] text-text-secondary">هزینه ماهانه</div>
        <div className="text-[26px] font-bold mt-1">{toFaNum(price)} تومان</div>
        <p className="text-[12px] text-text-secondary mt-2">برای یک ماه · تمدید از همین صفحه</p>
      </div>

      {error && <p className="text-error text-[13px] mb-3 text-center">{error}</p>}
      <Button loading={busy} onClick={buy}>{active ? "تمدید اشتراک حرفه‌ای" : "خرید اشتراک حرفه‌ای"}</Button>
    </div>
  );
}
