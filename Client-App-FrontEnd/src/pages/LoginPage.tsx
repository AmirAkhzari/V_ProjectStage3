import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import VisitorLogo from "@/components/ui/VisitorLogo";
import { ContainerTextFlip, VISITOR_TAGLINE_WORDS } from "@/components/ui/container-text-flip";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import { IconPhone } from "@/components/icons";
import { isValidIranMobile, normalizePhone } from "@/lib/phone";
import { api } from "@/services/client";
import { useAppStore } from "@/store/useAppStore";
import ThemeToggle from "@/components/ui/ThemeToggle";
import AppShell from "@/components/layout/AppShell";

export default function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const setSession = useAppStore((s) => s.setSession);
  const clearCart = useAppStore((s) => s.clearCart);
  const clearCoupon = useAppStore((s) => s.clearCoupon);
  const hydrate = useAppStore((s) => s.hydrate);

  const continueLogin = async () => {
    if (!isValidIranMobile(phone)) {
      setError("شماره موبایل معتبر وارد کنید (مثال ۰۹۱۲۳۴۵۶۷۸۹)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.sendOtp(phone);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      navigate("/otp", { state: { phone: normalizePhone(phone) } });
    } catch {
      setError("ارسال کد ناموفق بود. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  };

  const demo = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.loginDemo();
      setSession(res.data);
      clearCart();
      clearCoupon();
      await hydrate();
      navigate("/");
    } catch {
      setError("ورود آزمایشی ناموفق بود. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      {loading && <BrandedWaitScreen overlay />}
      <div className="relative flex-1 min-h-0 overflow-y-auto flex flex-col px-5 pt-10 pb-8 bg-page" inert={loading || undefined}>
        {termsOpen && (
          <div className="absolute inset-0 z-40 bg-ink/55 flex flex-col justify-end" onClick={() => setTermsOpen(false)}>
            <div className="bg-card rounded-t-[20px] p-5 sheet-up" dir="rtl" onClick={(event) => event.stopPropagation()}>
              <div className="font-semibold text-center text-[17px] mb-3">قوانین و شرایط</div>
              <ul className="text-[13px] text-text-secondary leading-7 list-disc pr-4 space-y-1">
                <li>این نسخه نمایشی است و پرداخت واقعی انجام نمی‌شود.</li>
                <li>هر سبد فقط از یک شرکت پخش پر می‌شود.</li>
                <li>حداقل سفارش ۵۰۰ هزار تومان است.</li>
                <li>زمان تحویل برای ثبت سفارش الزامی است.</li>
              </ul>
              <button type="button" onClick={() => setTermsOpen(false)} className="w-full h-12 mt-4 text-accent font-semibold">متوجه شدم</button>
            </div>
          </div>
        )}
        <div className="flex justify-end mb-8">
          <ThemeToggle compact />
        </div>
        <div className="flex flex-col items-center pt-6 pb-12">
          <VisitorLogo />
          <h1 className="mt-3 flex items-baseline justify-center gap-1.5">
            <span className="text-[22px] font-semibold text-text-secondary">سفارش عمده</span>
            <ContainerTextFlip
              className="text-[22px] font-semibold"
              words={[...VISITOR_TAGLINE_WORDS]}
            />
          </h1>
        </div>
        <p className="text-[15px] text-text-secondary mb-3">شماره موبایل خود را وارد کنید</p>
        <label className="text-[13px] text-text-secondary mb-2">شماره موبایل</label>
        <div className="relative">
          <TextField
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(""); }}
            placeholder="مثلا ۰۹۱۲۳۴۵۶۷۸۹"
            inputMode="tel"
            dir="ltr"
            className="text-right pl-10"
          />
          <span className="absolute top-1/2 left-3.5 -translate-y-1/2 text-secondary">
            <IconPhone />
          </span>
        </div>
        {error && <p className="text-error text-[13px] mt-2">{error}</p>}
        <div className="bg-card rounded-[10px] p-4 mt-5">
          <div className="font-semibold mb-1">عضو ویزیتور هستید؟</div>
          <p className="text-[13px] text-text-secondary leading-6">با شماره موبایل ویزیتورتان وارد شوید تا آدرس‌هایتان را ببینید.</p>
        </div>
        <div className="flex-1" />
        <Button onClick={continueLogin} loading={loading} disabled={loading}>{loading ? "لطفا صبر کنید..." : "ادامه"}</Button>
        <Button variant="ghost" className="mt-1" onClick={demo} disabled={loading}>ورود آزمایشی</Button>
        <p className="text-center text-[13px] text-label-tertiary mt-3">
          با زدن ادامه{" "}
          <button type="button" className="text-text-primary font-medium min-h-11" onClick={() => setTermsOpen(true)}>قوانین و شرایط</button>
          {" "}را می‌پذیرم.
        </p>
      </div>
    </AppShell>
  );
}
