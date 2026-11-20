import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BackHeader from "@/components/layout/BackHeader";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import { useAppStore } from "@/store/useAppStore";
import { api } from "@/services/client";
import { DEMO_COUPONS, DEMO_FAQS, DEMO_GIFTS, DEMO_MESSAGES } from "@/data/account";
import { toFaNum } from "@/lib/format";

export default function EditProfilePage() {
  const navigate = useNavigate();
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);
  const setToast = useAppStore((s) => s.setToast);
  const [name, setName] = useState(session?.user.name ?? "");
  const save = async () => {
    const res = await api.updateProfile({ name });
    if (!res.ok) {
      setToast(res.error);
      return;
    }
    if (session) setSession({ ...session, user: res.data });
    setToast("پروفایل ذخیره شد");
    navigate("/profile");
  };
  return (
    <div dir="rtl" className="flex-1 min-h-0 overflow-y-auto text-right bg-page">
      <BackHeader title="ویرایش پروفایل" />
      <div className="p-5">
        <label className="text-[13px] font-semibold">نام فروشگاه / مسئول خرید</label>
        <TextField className="mt-2 mb-4" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={save}>ذخیره</Button>
      </div>
    </div>
  );
}

export function MessagesPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page">
      <BackHeader title="پیام‌ها" />
      <div className="p-4 flex flex-col gap-2.5">
        {DEMO_MESSAGES.map((m) => (
          <div key={m.id} className={`bg-card rounded-2xl border p-4 ${m.unread ? "border-accent" : "border-border"}`}>
            <div className="flex justify-between items-start gap-3">
              {m.unread && <span className="size-2 rounded-full bg-accent mt-1.5 shrink-0" />}
              <div className="flex-1 text-right">
                <div className="font-extrabold text-[14px]">{m.title}</div>
                <p className="text-[13px] text-text-secondary leading-7 mt-1">{m.body}</p>
                <div className="text-[11px] text-secondary mt-1">{m.time}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiscountsPage() {
  const setToast = useAppStore((s) => s.setToast);
  const applyCouponCode = useAppStore((s) => s.applyCouponCode);
  const couponCode = useAppStore((s) => s.couponCode);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page">
      <BackHeader title="کدهای تخفیف" />
      <div className="p-4 flex flex-col gap-3">
        {DEMO_COUPONS.map((c) => (
          <div key={c.id} className="bg-card rounded-2xl border border-border p-4 flex items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(c.code); setToast("کد کپی شد"); }} className="min-h-11 px-3 rounded-xl bg-fill text-accent text-[12px] font-bold">کپی</button>
              <button
                type="button"
                onClick={() => applyCouponCode(c.code)}
                className="min-h-11 px-3 rounded-xl bg-accent text-inverse text-[12px] font-bold"
              >
                {couponCode === c.code ? "اعمال‌شده" : "اعمال روی سبد"}
              </button>
            </div>
            <div className="text-right flex-1">
              <div className="font-extrabold">{c.title}</div>
              <div className="text-[12px] text-text-secondary mt-1">{c.desc} · {c.expires}</div>
              <div className="mt-2 font-black tracking-widest">{c.code}</div>
            </div>
            <div className="size-14 rounded-2xl bg-brand-tint text-accent font-black text-sm flex items-center justify-center">{c.off}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GiftCardsPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page">
      <BackHeader title="کارت‌های هدیه" />
      <div className="p-4 flex flex-col gap-3">
        {DEMO_GIFTS.map((g) => (
          <div key={g.id} className="bg-accent text-inverse rounded-[22px] p-5">
            <div className="text-[12px] text-inverse/70">{g.status}</div>
            <div className="text-[22px] font-black mt-2">{toFaNum(g.amount)} تومان</div>
            <div className="text-[13px] mt-1">{g.title}</div>
            <div className="text-[11px] text-inverse/70 mt-3">{g.expires}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SupportPage() {
  const [open, setOpen] = useState<string | null>(DEMO_FAQS[0].q);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page">
      <BackHeader title="پشتیبانی" />
      <div className="p-4 flex flex-col gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-[14px] leading-8">برای پیگیری سفارش و موجودی با پشتیبانی ویزیتور در ارتباط باشید.</p>
          <a className="block text-accent font-black mt-2" href="tel:02191000000">۰۲۱-۹۱۰۰۰۰۰۰</a>
          <p className="text-text-secondary text-sm mt-1">ساعات پاسخگویی: ۹ تا ۱۸</p>
        </div>
        {DEMO_FAQS.map((item) => (
          <button key={item.q} type="button" onClick={() => setOpen(open === item.q ? null : item.q)} className="bg-card rounded-2xl border border-border p-4 text-right">
            <div className="font-extrabold">{item.q}</div>
            {open === item.q && <p className="text-[13px] text-text-secondary leading-7 mt-2">{item.a}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
