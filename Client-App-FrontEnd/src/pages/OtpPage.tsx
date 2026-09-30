import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import Button from "@/components/ui/Button";
import OtpSlots from "@/components/ui/OtpSlots";
import { IconCheck, IconChevronRight } from "@/components/icons";
import { toAsciiDigits, toFaDigits } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { DEMO_OTP } from "@/types";
import { api } from "@/services/client";
import { useAppStore } from "@/store/useAppStore";

export default function OtpPage() {
  const navigate = useNavigate();
  const phone = (useLocation().state as { phone?: string } | null)?.phone;
  const [digits, setDigits] = useState(["", "", "", "", ""]);
  const [seconds, setSeconds] = useState(119);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const setSession = useAppStore((s) => s.setSession);
  const hydrate = useAppStore((s) => s.hydrate);

  useEffect(() => {
    if (!phone) navigate("/login", { replace: true });
    else refs.current[0]?.focus();
  }, [phone, navigate]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const filled = digits.every(Boolean);
  const code = digits.join("");

  const handleDigit = (i: number, val: string) => {
    const only = toAsciiDigits(val).replace(/\D/g, "");
    if (only.length > 1) {
      const next = ["", "", "", "", ""];
      only.slice(0, 5).split("").forEach((ch, idx) => { next[idx] = ch; });
      setDigits(next);
      refs.current[Math.min(only.length - 1, 4)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = only.slice(-1);
    setDigits(next);
    if (only && i < 4) refs.current[i + 1]?.focus();
  };

  const submit = async () => {
    if (!phone || !filled) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.verifyOtp(phone, code);
      if (!res.ok) {
        setError(res.error);
        setDigits(["", "", "", "", ""]);
        refs.current[0]?.focus();
        return;
      }
      setSession(res.data);
      await hydrate();
      const addresses = await api.getAddresses();
      navigate(addresses.length ? "/" : "/addresses", { replace: true });
    } catch {
      setError("تایید کد ناموفق بود. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      {loading && <BrandedWaitScreen overlay />}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-5 pt-4 pb-8 bg-page" inert={loading || undefined}>
        <button type="button" onClick={() => navigate("/login")} className="self-end w-9 h-9 rounded-full bg-surface-gray flex items-center justify-center" aria-label="بازگشت">
          <IconChevronRight />
        </button>
        <div className="mt-6 mb-8">
          <span className="text-accent"><IconCheck size={40} /></span>
          <h1 className="text-[26px] font-extrabold mt-4 mb-2">تایید شماره</h1>
          <p className="text-[15px] leading-8">کد تایید به <strong>{formatPhoneDisplay(phone ?? "")}</strong> ارسال شد</p>
          <p className="text-[12px] text-text-secondary mt-1">کد آزمایشی: {toFaDigits(DEMO_OTP)}</p>
          <button type="button" onClick={() => navigate("/login")} className="text-text-link text-[13px] font-semibold mt-1">ویرایش شماره</button>
        </div>
        <label className="text-[13px] font-semibold mb-3"><span className="text-error">*</span> کد پیامک شده را وارد کنید</label>
        <OtpSlots
          digits={digits}
          refs={refs}
          error={Boolean(error)}
          loading={loading}
          onDigit={handleDigit}
          onBackspace={(index) => refs.current[index - 1]?.focus()}
        />
        <div className="text-center text-[13px] text-text-secondary">
          {seconds <= 0 ? (
            <button type="button" className="text-accent font-bold" onClick={() => { setSeconds(119); if (phone) void api.sendOtp(phone); }}>ارسال مجدد کد</button>
          ) : (
            <span>{toFaDigits(seconds)} ثانیه تا دریافت کد جدید</span>
          )}
        </div>
        {error && <p className="text-error text-center mt-3 text-sm">{error}</p>}
        <div className="flex-1" />
        <Button disabled={!filled || loading} loading={loading} onClick={submit}>{loading ? "در حال بررسی..." : "تایید شماره موبایل"}</Button>
      </div>
    </AppShell>
  );
}
