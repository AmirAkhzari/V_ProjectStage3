import { useNavigate } from "react-router-dom";
import { toFaNum } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

const BENEFITS = [
  "مشاهده همه شرکت‌های پخش شهر",
  "مقایسه قیمت بین شرکت‌ها",
  "سفارش از هر شرکت پوشش‌دهنده شهر",
  "تغییر شرکت پخش بدون محدودیت",
];

export function PlanBenefits({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={`text-right ${compact ? "space-y-1.5 text-[13px]" : "space-y-2.5 text-[14px]"}`}>
      {BENEFITS.map((item) => (
        <li key={item} className="flex items-start justify-end gap-2">
          <span className="leading-7">{item}</span>
          <span className="mt-1.5 size-1.5 rounded-full bg-accent shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export default function PlanUpsell() {
  const navigate = useNavigate();
  const open = useAppStore((s) => s.upsellOpen);
  const close = useAppStore((s) => s.closePlanUpsell);
  const price = useAppStore((s) => s.proMonthlyPrice);
  const plan = useAppStore((s) => s.plan);

  if (!open || plan === "pro") return null;

  return (
    <div className="absolute inset-0 z-50 bg-ink/55 flex flex-col justify-end" onClick={close}>
      <div className="bg-card rounded-t-[20px] p-6 sheet-up" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <div className="font-semibold text-center text-[17px] mb-1">اشتراک حرفه‌ای</div>
        <p className="text-[13px] text-text-secondary text-center leading-7 mb-4">
          برای دیدن بازار شرکت‌های پخش و مقایسه قیمت، اشتراک حرفه‌ای لازم است.
        </p>
        <PlanBenefits compact />
        <div className="mt-4 mb-5 text-center">
          <div className="text-[13px] text-text-secondary">هزینه ماهانه</div>
          <div className="font-bold text-[20px] mt-0.5">{toFaNum(price)} تومان</div>
        </div>
        <button
          type="button"
          onClick={() => {
            close();
            navigate("/subscription");
          }}
          className="w-full h-[50px] rounded-[14px] bg-accent text-inverse font-semibold"
        >
          مشاهده اشتراک حرفه‌ای
        </button>
        <button type="button" onClick={close} className="w-full h-12 text-text-secondary">بعداً</button>
      </div>
    </div>
  );
}

export function PlanUpsellCard({ reason }: { reason?: string }) {
  const navigate = useNavigate();
  const price = useAppStore((s) => s.proMonthlyPrice);
  return (
    <div className="bg-card rounded-[14px] p-4 text-right" dir="rtl">
      <div className="font-semibold text-[15px]">بازار شرکت‌های پخش با اشتراک حرفه‌ای</div>
      <p className="text-[13px] text-text-secondary leading-7 mt-1">
        {reason ?? "سایر شرکت‌های شهر و مقایسه قیمت فقط با اشتراک حرفه‌ای در دسترس است."}
      </p>
      <div className="text-[12px] text-text-secondary mt-2">{toFaNum(price)} تومان در ماه</div>
      <button type="button" onClick={() => navigate("/subscription")} className="mt-3 h-11 px-4 rounded-[12px] bg-accent text-inverse text-[13px] font-semibold">
        فعال‌سازی اشتراک حرفه‌ای
      </button>
    </div>
  );
}
