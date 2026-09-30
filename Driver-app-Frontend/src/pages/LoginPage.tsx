import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Lock, TriangleAlert, UserRound } from "lucide-react";
import Button from "@/components/ui/Button";
import BottomSheet from "@/components/ui/BottomSheet";
import VisitorLogo from "@/components/ui/VisitorLogo";
import { api, isMockMode } from "@/services/client";
import { demoOpenCodes } from "@/services/mockApi";
import { DEMO_PASSWORD } from "@/services/seed";
import { NetworkError } from "@/services/api";
import { useSessionStore } from "@/store/useSessionStore";
import { toFaDigits } from "@/lib/format";
import type { LoginError } from "@/types";

const LOGIN_ERRORS: Record<LoginError, string> = {
  invalid_credentials: "شناسه یا رمز عبور درست نیست.",
  inactive: "حساب کاربری شما غیرفعال است. با مدیر شرکت پخش تماس بگیرید.",
  too_many_attempts: "تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره امتحان کنید.",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const signOutReason = useSessionStore((s) => s.signOutReason);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(
    signOutReason === "inactive"
      ? LOGIN_ERRORS.inactive
      : signOutReason === "expired"
        ? "نشست شما به پایان رسید. دوباره وارد شوید."
        : null,
  );
  const [loading, setLoading] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const signIn = async (user: string, pass: string) => {
    if (!user.trim() || !pass) {
      setError("شناسه راننده و رمز عبور را وارد کنید.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(user, pass);
      if (!res.ok) {
        setError(LOGIN_ERRORS[res.error]);
        return;
      }
      setSession(res.data);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof NetworkError && err.kind === "offline"
          ? "اتصال اینترنت برقرار نیست."
          : "ورود ناموفق بود. دوباره تلاش کنید.",
      );
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(username, password);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-y-auto px-5 pt-12 pb-6" noValidate>
      <div className="flex flex-col items-center pt-8 pb-10">
        <VisitorLogo suffix="راننده" />
        <p className="mt-3 text-[15px] text-label-secondary">اجرای توزیع و ثبت کد تحویل</p>
      </div>

      <label htmlFor="username" className="mb-2 text-[13px] text-label-secondary">
        شناسه راننده
      </label>
      <div className="relative mb-4">
        <input
          id="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError(null);
          }}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          placeholder="ali.rezaei"
          className="h-[54px] w-full rounded-[14px] bg-fill pr-4 pl-11 text-left text-[17px] outline-none placeholder:text-label-tertiary focus:bg-fill-secondary"
        />
        <UserRound className="absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-label-secondary" aria-hidden />
      </div>

      <label htmlFor="password" className="mb-2 text-[13px] text-label-secondary">
        رمز عبور
      </label>
      <div className="relative">
        <input
          id="password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          autoComplete="current-password"
          dir="ltr"
          className="h-[54px] w-full rounded-[14px] bg-fill pr-12 pl-11 text-left text-[17px] outline-none focus:bg-fill-secondary"
        />
        <Lock className="absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-label-secondary" aria-hidden />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute top-1/2 right-1.5 flex size-11 -translate-y-1/2 items-center justify-center text-label-secondary"
          aria-label={showPassword ? "پنهان کردن رمز" : "نمایش رمز"}
        >
          {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>

      {error ? (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-error/10 p-3 text-[14px] text-error">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <p className="mt-4 text-[13px] leading-6 text-label-secondary">
        شناسه و رمز عبور را مدیر شرکت پخش برای شما ساخته است. اگر رمز را فراموش کرده‌اید از مدیر بخواهید آن را بازنشانی
        کند.
      </p>

      <div className="min-h-8 flex-1" />

      <Button type="submit" loading={loading}>
        {loading ? "در حال ورود…" : "ورود"}
      </Button>

      {isMockMode ? (
        <>
          <Button
            variant="ghost"
            className="mt-1"
            disabled={loading}
            onClick={() => void signIn("ali.rezaei", DEMO_PASSWORD)}
          >
            ورود آزمایشی
          </Button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="mx-auto mt-1 flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-label-secondary"
          >
            <KeyRound className="size-4" aria-hidden /> راهنمای نسخه نمایشی
          </button>
          <DemoGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
        </>
      ) : null}
    </form>
  );
}

/** Mock mode only: in production the customer is the only party who has the delivery code. */
function DemoGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const codes = open ? demoOpenCodes() : [];
  return (
    <BottomSheet open={open} onClose={onClose} title="راهنمای نسخه نمایشی">
      <div className="no-scrollbar max-h-[60vh] overflow-y-auto text-[13px] leading-6">
        <div className="mb-2 font-semibold">حساب‌ها (رمز همه: {toFaDigits(DEMO_PASSWORD)})</div>
        <ul className="mb-4 space-y-1 text-label-secondary">
          <li>
            <span className="ltr font-semibold text-foreground">ali.rezaei</span> — راننده فعال با مسیر امروز
          </li>
          <li>
            <span className="ltr font-semibold text-foreground">hamid.nouri</span> — حساب غیرفعال (خطای ورود)
          </li>
        </ul>
        <div className="mb-2 font-semibold">کدهای تحویل (در واقعیت فقط مشتری دارد)</div>
        <ul className="space-y-1.5">
          {codes.map((c) => (
            <li key={c.orderNumber} className="flex items-center justify-between rounded-xl bg-fill px-3 py-2">
              <span>
                {c.shop} <span className="ltr text-label-secondary">{c.orderNumber}</span>
              </span>
              <span className="ltr font-bold tracking-widest">{toFaDigits(c.code)}</span>
            </li>
          ))}
          {codes.length === 0 ? <li className="text-label-secondary">همه کدها ثبت شده‌اند.</li> : null}
        </ul>
        <p className="mt-3 text-label-secondary">
          برای دیدن خطا، کد اشتباه وارد کنید؛ پس از ۵ تلاش ناموفق ثبت کد ۱۵ دقیقه قفل می‌شود.
        </p>
      </div>
    </BottomSheet>
  );
}
