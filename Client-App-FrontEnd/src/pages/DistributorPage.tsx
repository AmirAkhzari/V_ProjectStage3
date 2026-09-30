import { useNavigate } from "react-router-dom";
import { PlanUpsellCard } from "@/components/plan/PlanUpsell";
import { DISTRIBUTORS } from "@/data/catalog";
import { distributorsInCity, userCity } from "@/lib/distributors";
import { canBrowseMarketplace, lockedCityTeasers } from "@/lib/plan";
import { toFaNum } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

export default function DistributorPage() {
  const navigate = useNavigate();
  const activeId = useAppStore((s) => s.distributorId);
  const addresses = useAppStore((s) => s.addresses);
  const selectedAddressId = useAppStore((s) => s.selectedAddressId);
  const distributors = useAppStore((s) => s.distributors);
  const plan = useAppStore((s) => s.plan);
  const primaryDistributorId = useAppStore((s) => s.primaryDistributorId);
  const city = userCity(addresses, selectedAddressId);
  const localCity = distributorsInCity(city, DISTRIBUTORS);
  const companies = canBrowseMarketplace(plan)
    ? distributorsInCity(city, distributors.length ? distributors : DISTRIBUTORS).map((row) => ({
        ...row,
        isPrimary: row.id === primaryDistributorId,
        locked: false,
      }))
    : lockedCityTeasers(localCity.length ? localCity : distributorsInCity(city, distributors), primaryDistributorId, plan);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto relative bg-page">
      <div className="bg-page px-5 py-4 font-semibold text-[17px] text-center border-b border-separator">
        {city ? `شرکت‌های پخش ${city}` : "انتخاب شرکت توزیع"}
      </div>
      <div className="p-4 space-y-3.5">
        {!city && <p className="text-sm text-text-secondary text-center py-8">اول آدرس فروشگاه را انتخاب کنید تا پخش همان شهر دیده شود.</p>}
        {city && companies.length === 0 && <p className="text-sm text-text-secondary text-center py-8">در این شهر شرکت پخش فعالی نیست.</p>}
        {!canBrowseMarketplace(plan) && city && companies.some((item) => item.locked) && (
          <PlanUpsellCard reason="بقیه شرکت‌های این شهر قفل هستند. با اشتراک حرفه‌ای بازار را باز کنید." />
        )}
        {companies.map((d) => {
          const active = d.id === activeId;
          const full = d.status === "full";
          const locked = Boolean(d.locked);
          return (
            <div key={d.id} className={`relative bg-card rounded-[14px] p-4 overflow-hidden ${active ? "ring-1 ring-accent" : ""} ${full && !locked ? "opacity-60" : ""}`}>
              {locked && <div className="absolute inset-0 bg-card/70 backdrop-blur-[3px] z-10" />}
              <div className={`flex items-start gap-3 ${locked ? "select-none" : ""}`}>
                <div className={`w-16 h-16 rounded-[14px] text-[11px] font-semibold flex items-center justify-center text-center whitespace-pre-line ${d.logoTone === "accent" ? "bg-accent text-inverse" : "bg-fill text-accent"}`}>{d.logoText}</div>
                <div className="flex-1">
                  <div className="flex gap-1.5 justify-end mb-1">
                    {d.isPrimary && <span className="text-[10px] font-semibold bg-fill text-accent px-2 py-0.5 rounded-full">شرکت اصلی</span>}
                    {active && !locked && <span className="text-[10px] font-semibold bg-fill text-accent px-2 py-0.5 rounded-full">انتخاب فعلی</span>}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${full ? "bg-fill text-error" : "bg-fill text-accent"}`}>{full ? "ظرفیت امروز تکمیل شده" : "فعال"}</span>
                  </div>
                  <div className="font-semibold text-[14px]">{d.name}</div>
                  {!locked && (
                    <div className="text-[11px] text-text-secondary mt-1">تا {toFaNum(d.deliveryMins)} دقیقه · {d.deliveryFee === "free" ? "ارسال رایگان" : `${toFaNum(d.deliveryFee)} تومان ارسال`}</div>
                  )}
                  {locked && <div className="text-[11px] text-text-secondary mt-1">برای دیدن فروشگاه و قیمت‌ها اشتراک حرفه‌ای لازم است</div>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate(locked ? "/subscription" : `/distributors/${d.id}`)}
                className="relative z-20 mt-3 h-11 px-5 rounded-[12px] bg-accent text-inverse text-[13px] font-semibold"
              >
                {locked ? "فعال‌سازی اشتراک حرفه‌ای" : full ? "مشاهده کالاها" : "ورود به فروشگاه"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
