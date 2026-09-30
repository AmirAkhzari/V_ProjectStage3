import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/services/client";
import { useSessionStore } from "@/store/useSessionStore";
import { isValidIranMobile, normalizePhone } from "@/lib/phone";
import { paths } from "@/routes/paths";
import { DEMO_SUPER_ADMIN_PHONE } from "@/services/seed/staff";
import { toFaDigits } from "@/lib/format";

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<null | "otp" | "super_admin" | "distributor_admin">(null);

  const sendOtp = async () => {
    if (!isValidIranMobile(phone)) {
      setError("شماره موبایل معتبر وارد کنید (مثال ۰۹۱۲۳۴۵۶۷۸۹)");
      return;
    }
    setLoading("otp");
    const res = await api.sendOtp(phone);
    setLoading(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate(paths.otp, { state: { phone: normalizePhone(phone) } });
  };

  const demo = async (role: "super_admin" | "distributor_admin") => {
    setLoading(role);
    const res = await api.loginDemo(role);
    setSession(res.data);
    setLoading(null);
    navigate(paths.dashboard);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold">ورود به پنل مدیریت</h1>
        <p className="mt-1 text-[13px] text-label-secondary">
          شماره موبایل مدیریتی خود را وارد کنید تا کد تایید ارسال شود.
        </p>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendOtp();
        }}
      >
        <Label htmlFor="phone">شماره موبایل</Label>
        <div className="relative">
          <Input
            id="phone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setError("");
            }}
            placeholder={toFaDigits("09123456789")}
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            className="h-12 pl-10 text-right text-[15px]"
          />
          <Phone className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-label-tertiary" />
        </div>
        {error ? (
          <p className="text-[12px] text-destructive">{error}</p>
        ) : (
          <p className="text-[12px] text-label-tertiary">شماره نمایشی: {toFaDigits(DEMO_SUPER_ADMIN_PHONE)}</p>
        )}
        <Button type="submit" size="lg" className="mt-2" loading={loading === "otp"} disabled={loading !== null}>
          ادامه
        </Button>
      </form>

      <div className="flex items-center gap-3 text-[11px] text-label-tertiary">
        <Separator className="flex-1" />
        ورود آزمایشی
        <Separator className="flex-1" />
      </div>

      <div className="grid gap-2">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => demo("super_admin")}
          loading={loading === "super_admin"}
          disabled={loading !== null}
        >
          <ShieldCheck /> مدیر پلتفرم
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => demo("distributor_admin")}
          loading={loading === "distributor_admin"}
          disabled={loading !== null}
        >
          <Truck /> مدیر شرکت پخش (توزیع و پخش البرز)
        </Button>
      </div>
    </div>
  );
}
