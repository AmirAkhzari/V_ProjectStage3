import { useNavigate } from "react-router-dom";
import VisitorLogo from "@/components/ui/VisitorLogo";
import { IconMapPin } from "@/components/icons";
import { getDistributor, userCity } from "@/lib/distributors";
import { useAppStore } from "@/store/useAppStore";

export default function BrandHeader() {
  const navigate = useNavigate();
  const session = useAppStore((s) => s.session);
  const distributorId = useAppStore((s) => s.distributorId);
  const primaryDistributorId = useAppStore((s) => s.primaryDistributorId);
  const distributors = useAppStore((s) => s.distributors);
  const addresses = useAppStore((s) => s.addresses);
  const selectedAddressId = useAppStore((s) => s.selectedAddressId);
  const active = getDistributor(distributorId, distributors)
    ?? getDistributor(primaryDistributorId ?? "", distributors);
  const shopName = session?.user.name?.trim() ?? "";
  const distributorName = active?.name?.trim() ?? "";
  const city = userCity(addresses, selectedAddressId);

  return (
    <header className="shrink-0 px-5 pt-3 pb-2 bg-page" dir="rtl">
      <div className="flex justify-center mb-2">
        <VisitorLogo size="sm" />
      </div>
      <div dir="ltr" className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 text-left">
          <div className="text-[13px] font-semibold truncate text-text-primary">{shopName}</div>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <div className="text-[13px] font-semibold truncate text-text-primary">{distributorName}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate("/addresses")}
        className="mt-2 w-full min-h-11 flex items-center justify-end gap-1.5 text-[13px] text-text-secondary"
      >
        <span className="truncate">{city || "ثبت آدرس فروشگاه"}</span>
        <IconMapPin size={14} />
      </button>
    </header>
  );
}
