import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import Button from "@/components/ui/Button";
import { IlluFail } from "@/components/illustrations";
import { toFaNum } from "@/lib/format";
import { api } from "@/services/client";
import { useAppStore } from "@/store/useAppStore";

export default function PaymentPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const clearCart = useAppStore((s) => s.clearCart);
  const clearCoupon = useAppStore((s) => s.clearCoupon);
  const refreshOrders = useAppStore((s) => s.refreshOrders);
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const refreshEntitlement = useAppStore((s) => s.refreshEntitlement);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  // A34 is not mounted, so a plan checkout announces itself; A34 supersedes this when it returns.
  const [kind, setKind] = useState<"order" | "wallet" | "subscription">(
    params.get("kind") === "subscription" ? "subscription" : "order",
  );
  const [gatewayAuthority, setGatewayAuthority] = useState<string | null>(null);
  const [error, setError] = useState("");
  const failFlag = params.get("fail") === "1";
  const subscription = kind === "subscription";

  useEffect(() => {
    if (!id) return;
    if (!subscription) {
      void api.getPayment(id).then((p) => {
        setAmount(p?.amount ?? null);
        if (p?.kind) setKind(p.kind);
      });
      return;
    }
    // A36 hands back the gateway redirect: a real PSP URL is followed, but the mock's `mock://` cannot
    // be, so the demo screen settles it through the provider callback (S3) instead.
    let cancelled = false;
    void api
      .startPayment(id)
      .then((start) => {
        if (cancelled) return;
        if (/^https?:/i.test(start.redirectUrl)) {
          window.location.assign(start.redirectUrl);
          return;
        }
        setAmount(start.amount);
        setGatewayAuthority(start.authority);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "شروع پرداخت ناموفق بود");
      });
    return () => {
      cancelled = true;
    };
  }, [id, subscription]);

  const finish = async (status: "ok" | "fail") => {
    if (!id) return;
    setBusy(true);
    try {
      if (subscription) {
        if (!gatewayAuthority) {
          setBusy(false);
          return;
        }
        const res = await api.completeGatewayPayment(gatewayAuthority, status);
        if (!res.ok) {
          navigate("/subscription?fail=1");
          return;
        }
        await refreshEntitlement();
        navigate("/subscription?ok=1", { replace: true });
        return;
      }
      const res = await api.completePayment(id, status);
      if (!res.ok) {
        navigate(subscription ? "/subscription?fail=1" : `/payment-failed?id=${id}`);
        return;
      }
      if (res.data.plan === "pro" || subscription) {
        await refreshEntitlement();
        navigate("/subscription?ok=1", { replace: true });
        return;
      }
      if (res.data.order) {
        clearCart();
        clearCoupon();
        await refreshOrders();
        navigate(`/orders/${res.data.order.id}?confirmed=1`, { replace: true });
        return;
      }
      await refreshWallet();
      navigate("/profile?wallet=1", { replace: true });
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center p-6 bg-page">
      {busy && <BrandedWaitScreen overlay />}
      <div className="w-full bg-card rounded-[22px] p-5 border border-border" inert={busy || undefined}>
        <div className="text-center mb-4">
          <p className="text-[11px] text-text-secondary">پرداخت واقعی انجام نمی‌شود</p>
          <p className="font-black text-lg mt-1">{subscription ? "تأیید اشتراک نمایشی" : "تأیید سفارش نمایشی"}</p>
        </div>
        <div className="bg-surface-gray rounded-2xl p-4 text-center mb-4">
          <div className="text-[12px] text-text-secondary">مبلغ نمایشی</div>
          <div className="text-[26px] font-black mt-1">{amount != null ? `${toFaNum(amount)} تومان` : "—"}</div>
          <div className="text-[12px] text-text-secondary mt-1">به شاپرک یا بانک وصل نیستیم؛ هیچ کارتی نگیرید.</div>
        </div>
        <p className="text-[12px] text-text-secondary leading-7 text-center mb-4">
          {subscription ? "این مرحله اشتراک حرفه‌ای نمایشی را فعال یا رد می‌کند." : "این مرحله فقط نتیجه ثبت سفارش آزمایشی را مشخص می‌کند."}
        </p>
        {error && <p className="text-error text-[12px] text-center mb-3">{error}</p>}
        <Button
          loading={busy}
          disabled={subscription && !gatewayAuthority}
          onClick={() => finish(failFlag ? "fail" : "ok")}
        >
          {subscription ? "تأیید اشتراک" : "تأیید ثبت سفارش"}
        </Button>
        <Button
          variant="danger"
          className="mt-2.5"
          disabled={busy || (subscription && !gatewayAuthority)}
          onClick={() => finish("fail")}
        >
          انصراف
        </Button>
      </div>
    </div>
  );
}

export function PaymentFailedPage() {
  const navigate = useNavigate();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center p-6 text-center bg-page">
      <IlluFail />
      <h1 className="text-[22px] font-black mb-3 mt-2">سفارش ثبت نشد</h1>
      <p className="text-[13px] text-success bg-brand-tint border border-border rounded-2xl p-3 mb-6">هیچ مبلغی کسر نشد. سبد خرید دست‌نخورده مانده است.</p>
      <Button onClick={() => navigate("/checkout")}>تلاش مجدد</Button>
      <Button variant="ghost" className="mt-2.5" onClick={() => navigate("/cart")}>بازگشت به سبد</Button>
    </div>
  );
}
