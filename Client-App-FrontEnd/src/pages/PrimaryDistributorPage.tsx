import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { cityIdFromName, distributorsInCity, userCity } from "@/lib/distributors";
import { toFaNum } from "@/lib/format";
import { api } from "@/services/client";
import { DISTRIBUTORS } from "@/data/catalog";
import type { Distributor } from "@/types";
import { useAppStore } from "@/store/useAppStore";

export default function PrimaryDistributorPage() {
  const navigate = useNavigate();
  const primaryDistributorId = useAppStore((s) => s.primaryDistributorId);
  const addresses = useAppStore((s) => s.addresses);
  const selectedAddressId = useAppStore((s) => s.selectedAddressId);
  const config = useAppStore((s) => s.config);
  const refreshEntitlement = useAppStore((s) => s.refreshEntitlement);
  const setToast = useAppStore((s) => s.setToast);
  const city = userCity(addresses, selectedAddressId);
  const [options, setOptions] = useState<Distributor[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (primaryDistributorId) {
      navigate("/", { replace: true });
    }
  }, [primaryDistributorId, navigate]);

  useEffect(() => {
    if (!city) {
      setReady(true);
      return;
    }
    let live = true;
    void (async () => {
      const cityId = cityIdFromName(city, config?.cities ?? []);
      try {
        const rows = await api.getDistributors(cityId ?? undefined);
        if (!live) return;
        setOptions(rows.length ? rows : distributorsInCity(city, DISTRIBUTORS));
      } catch {
        if (live) setOptions(distributorsInCity(city, DISTRIBUTORS));
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [city, config]);

  const submit = async () => {
    if (!picked) {
      setError("یک شرکت پخش را انتخاب کنید");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.setPrimaryDistributor(picked);
      await refreshEntitlement();
      setToast("شرکت پخش اصلی ثبت شد");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت شرکت پخش ناموفق بود");
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-secondary">
        <Spinner className="size-7 text-accent" />
        <span className="text-sm">در حال بارگذاری شرکت‌های پخش...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page" dir="rtl">
      <div className="px-5 py-4 border-b border-separator text-center font-semibold text-[17px]">انتخاب شرکت پخش اصلی</div>
      <div className="p-5">
        <p className="text-[14px] text-text-secondary leading-7 mb-4">
          این انتخاب فقط یک‌بار انجام می‌شود. با طرح رایگان فقط از همین شرکت خرید می‌کنید. برای دیدن بقیه بازار به اشتراک حرفه‌ای نیاز دارید.
        </p>
        {!city && (
          <div className="bg-card rounded-[14px] p-5 text-center">
            <p className="font-semibold mb-2">اول آدرس فروشگاه را ثبت کنید</p>
            <p className="text-[13px] text-text-secondary mb-4">شرکت پخش اصلی از روی شهر همان آدرس مشخص می‌شود.</p>
            <Button onClick={() => navigate("/addresses")}>انتخاب آدرس</Button>
          </div>
        )}
        {city && options.length === 0 && (
          <p className="text-[13px] text-text-secondary text-center py-8">در {city} شرکت پخش فعالی نیست.</p>
        )}
        <div className="space-y-3">
          {options.map((company) => {
            const selected = company.id === picked;
            return (
              <button
                key={company.id}
                type="button"
                onClick={() => { setPicked(company.id); setError(""); }}
                className={`w-full text-right bg-card rounded-[14px] p-4 ${selected ? "ring-1 ring-accent" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`size-14 rounded-[14px] text-[11px] font-semibold flex items-center justify-center text-center whitespace-pre-line ${company.logoTone === "accent" ? "bg-accent text-inverse" : "bg-fill text-accent"}`}>
                    {company.logoText}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[15px]">{company.name}</div>
                    <div className="text-[12px] text-text-secondary mt-1">تا {toFaNum(company.deliveryMins)} دقیقه · {company.cities.join("، ")}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {error && <p className="text-error text-[13px] mt-3 text-center">{error}</p>}
        {city && options.length > 0 && (
          <div className="mt-5">
            <Button loading={busy} disabled={!picked} onClick={submit}>ثبت شرکت پخش اصلی</Button>
          </div>
        )}
      </div>
    </div>
  );
}
