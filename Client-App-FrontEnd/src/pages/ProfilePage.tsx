import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconChevronLeft, IconGift, IconHeadset, IconMapPin, IconReceipt, IconTag } from "@/components/icons";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatPlanExpiry } from "@/lib/plan";
import { toFaNum } from "@/lib/format";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { shouldUseHttpApi } from "@/services/http";
import { setMockPlan } from "@/services/mockApi";
import { useAppStore } from "@/store/useAppStore";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const session = useAppStore((s) => s.session);
  const walletBalance = useAppStore((s) => s.walletBalance);
  const walletTx = useAppStore((s) => s.walletTx);
  const setToast = useAppStore((s) => s.setToast);
  const logout = useAppStore((s) => s.logout);
  const refreshWallet = useAppStore((s) => s.refreshWallet);
  const refreshEntitlement = useAppStore((s) => s.refreshEntitlement);
  const plan = useAppStore((s) => s.plan);
  const expiresAt = useAppStore((s) => s.subscriptionExpiresAt);
  const user = session?.user;
  const expiryLabel = formatPlanExpiry(expiresAt);
  const mockMode = !shouldUseHttpApi();

  useEffect(() => { void refreshWallet(); }, [refreshWallet]);
  useEffect(() => {
    if (params.get("wallet") === "1") {
      setToast("افزایش اعتبار با موفقیت انجام شد");
      params.delete("wallet");
      setParams(params, { replace: true });
    }
  }, [params, setParams, setToast]);
  const menu = [
    { label: "سفارش‌ها", to: "/orders", icon: <IconReceipt active={false} /> },
    { label: "آدرس‌ها", to: "/addresses", icon: <IconMapPin /> },
    { label: "پیام‌ها", to: "/messages", icon: <IconTag /> },
    { label: "کدهای تخفیف", to: "/discounts", icon: <IconTag /> },
    { label: "کارت‌های هدیه", to: "/gift-cards", icon: <IconGift /> },
    { label: "تماس با پشتیبانی", to: "/support", icon: <IconHeadset /> },
  ];

  return (
    <div dir="rtl" className="flex-1 min-h-0 overflow-y-auto p-4 relative text-right bg-page">
      <h1 className="text-[34px] font-bold px-1 mb-4">پروفایل</h1>
      <div className="bg-card rounded-[10px] p-4 mb-8">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-full bg-fill text-accent font-semibold text-[17px] flex items-center justify-center">{user?.name?.[0] ?? "و"}</div>
            <div>
              <div className="font-semibold text-[17px]">{user?.name}</div>
              <div className="text-[13px] text-text-secondary">{formatPhoneDisplay(user?.phone ?? "")}</div>
            </div>
          </div>
          <button type="button" onClick={() => navigate("/profile/edit")} className="text-accent text-[17px]">ویرایش</button>
        </div>
        <div className="bg-fill rounded-[10px] p-4 flex items-center justify-between gap-3">
          <div className="text-right">
            <div className="text-[13px] text-text-secondary">دوستاتو دعوت کن</div>
            <div className="font-semibold text-accent mt-0.5">{toFaNum(120000)} تومان هدیه بگیر</div>
          </div>
          <button type="button" onClick={() => navigate("/gift-cards")} className="bg-accent text-inverse text-[13px] font-semibold px-3 py-1.5 rounded-full shrink-0">دعوت از دوستان</button>
        </div>
      </div>
      <div className="mb-8">
        <h2 className="text-[20px] font-bold px-1 mb-3">اشتراک حرفه‌ای</h2>
        <div className="bg-card rounded-[10px] p-4">
          <div className="text-[13px] text-text-secondary">طرح فعلی</div>
          <div className="font-semibold text-[17px] mt-0.5">{plan === "pro" ? "حرفه‌ای" : "رایگان"}</div>
          {plan === "pro" && expiryLabel ? (
            <p className="text-[13px] text-text-secondary mt-1">تا {expiryLabel} فعال است</p>
          ) : (
            <p className="text-[13px] text-text-secondary mt-1 leading-7">بازار شرکت‌های پخش شهر و مقایسه قیمت با اشتراک حرفه‌ای.</p>
          )}
          <button
            type="button"
            onClick={() => navigate("/subscription")}
            className="w-full mt-4 h-[50px] rounded-[14px] bg-accent text-inverse font-semibold text-[17px]"
          >
            {plan === "pro" ? "تمدید اشتراک حرفه‌ای" : "خرید اشتراک حرفه‌ای"}
          </button>
        </div>
      </div>
      {mockMode && (
        <div className="bg-card rounded-[10px] mb-8 p-4 text-right">
          <div className="font-semibold mb-1">حالت آزمایشی طرح</div>
          <p className="text-[13px] text-text-secondary mb-3">برای تست رایگان و حرفه‌ای، طرح نمایشی را عوض کنید.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => { setMockPlan("free"); await refreshEntitlement(); setToast("طرح آزمایشی: رایگان"); }}
              className={`h-11 px-3 rounded-[12px] text-[13px] font-semibold ${plan === "free" ? "bg-accent text-inverse" : "bg-fill text-accent"}`}
            >
              رایگان
            </button>
            <button
              type="button"
              onClick={async () => { setMockPlan("pro"); await refreshEntitlement(); setToast("طرح آزمایشی: حرفه‌ای"); }}
              className={`h-11 px-3 rounded-[12px] text-[13px] font-semibold ${plan === "pro" ? "bg-accent text-inverse" : "bg-fill text-accent"}`}
            >
              حرفه‌ای
            </button>
          </div>
        </div>
      )}
      <div className="bg-card rounded-[10px] mb-8 p-4 flex justify-between items-center">
        <div className="text-right">
          <div className="text-[13px] text-text-secondary">کیف پول</div>
          <div className="font-semibold text-[17px]">{toFaNum(walletBalance)} تومان</div>
        </div>
        <button type="button" onClick={() => navigate("/wallet")} className="text-accent text-[17px] font-normal">افزایش اعتبار</button>
      </div>
      {walletTx.length > 0 && (
        <div className="bg-card rounded-[10px] mb-8 p-4">
          <div className="font-semibold mb-2">تاریخچه کیف پول</div>
          {walletTx.slice(0, 3).map((tx) => (
            <div key={tx.id} className="flex justify-between py-2.5 border-t border-separator text-[13px]">
              <span className="text-accent font-medium">+{toFaNum(tx.amount)} تومان</span>
              <span className="text-text-secondary">{tx.createdAt}</span>
            </div>
          ))}
        </div>
      )}
      <div className="bg-card rounded-[10px] mb-8 p-4 flex justify-between items-center">
        <ThemeToggle />
        <div className="text-right">
          <div className="font-semibold">حالت تیره</div>
          <div className="text-[13px] text-text-secondary">ظاهر سیستم</div>
        </div>
      </div>
      <div className="bg-card rounded-[10px] overflow-hidden">
        {menu.map((item) => (
          <button key={item.label} type="button" onClick={() => navigate(item.to)} className="w-full flex justify-between items-center px-4 py-3 border-b border-separator last:border-0">
            <span className="flex items-center gap-2.5 text-[17px]">{item.icon} {item.label}</span>
            <span className="text-label-tertiary"><IconChevronLeft size={16} /></span>
          </button>
        ))}
      </div>
      <button type="button" onClick={async () => { await logout(); navigate("/login"); }} className="w-full mt-8 text-error font-semibold py-3">خروج از حساب</button>
      <p className="text-center text-[13px] text-label-tertiary pb-6">نسخه نمایشی ۱.۰</p>
    </div>
  );
}
