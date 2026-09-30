import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/services/client";
import { useSessionStore } from "@/store/useSessionStore";
import { paths } from "@/routes/paths";
import { formatPhoneDisplay } from "@/lib/phone";
import { toAsciiDigits, toFaDigits } from "@/lib/format";
import { DEMO_OTP } from "@/types";
import OtpSlots from "@/components/ui/OtpSlots";

const LENGTH = 5;

export default function OtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const phone = (location.state as { phone?: string } | null)?.phone;
  const setSession = useSessionStore((s) => s.setSession);
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(119);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  if (!phone) return <Navigate to={paths.login} replace />;

  const submit = async (code: string) => {
    setLoading(true);
    const res = await api.verifyOtp(phone, code);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setDigits(Array(LENGTH).fill(""));
      refs.current[0]?.focus();
      return;
    }
    setSession(res.data);
    navigate(paths.dashboard, { replace: true });
  };

  const update = (index: number, raw: string) => {
    const value = toAsciiDigits(raw).replace(/\D/g, "");
    setError("");
    if (value.length > 1) {
      const next = [...digits];
      value
        .split("")
        .slice(0, LENGTH - index)
        .forEach((d, i) => (next[index + i] = d));
      setDigits(next);
      const filled = next.join("");
      if (filled.length === LENGTH) void submit(filled);
      else refs.current[Math.min(index + value.length, LENGTH - 1)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    if (value && index < LENGTH - 1) refs.current[index + 1]?.focus();
    const filled = next.join("");
    if (filled.length === LENGTH) void submit(filled);
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => navigate(paths.login)}
        className="inline-flex w-fit items-center gap-1 text-[12px] text-label-secondary hover:text-foreground"
      >
        <ArrowRight className="size-3.5" /> تغییر شماره
      </button>
      <div>
        <h1 className="text-[22px] font-semibold">کد تایید</h1>
        <p className="mt-1 text-[13px] text-label-secondary">
          کد ۵ رقمی ارسال‌شده به{" "}
          <span className="ltr inline-block font-semibold text-foreground">{formatPhoneDisplay(phone)}</span> را وارد
          کنید.
        </p>
      </div>

      <OtpSlots
        digits={digits}
        refs={refs}
        error={Boolean(error)}
        loading={loading}
        onDigit={update}
        onBackspace={(index) => refs.current[index - 1]?.focus()}
      />
      {error ? (
        <p className="text-[12px] text-destructive">{error}</p>
      ) : (
        <p className="text-[12px] text-label-tertiary">کد نمایشی: {toFaDigits(DEMO_OTP)}</p>
      )}

      <Button
        size="lg"
        loading={loading}
        disabled={digits.join("").length !== LENGTH || loading}
        onClick={() => void submit(digits.join(""))}
      >
        ورود
      </Button>

      <div className="text-center text-[12px] text-label-secondary">
        {seconds > 0 ? (
          <span>
            ارسال مجدد کد تا <span className="text-foreground tabular-nums">{toFaDigits(`${mm}:${ss}`)}</span>
          </span>
        ) : (
          <button
            type="button"
            className="font-semibold text-foreground"
            onClick={async () => {
              await api.sendOtp(phone);
              setSeconds(119);
            }}
          >
            ارسال مجدد کد
          </button>
        )}
      </div>
    </div>
  );
}
