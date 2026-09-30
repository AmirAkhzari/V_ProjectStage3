import { useNavigate } from "react-router-dom";
import { IconMapPin, IconPlus, IconSearch } from "@/components/icons";
import { useAppStore } from "@/store/useAppStore";

export default function AddressSelectPage() {
  const navigate = useNavigate();
  const addresses = useAppStore((s) => s.addresses);
  const selectedId = useAppStore((s) => s.selectedAddressId);
  const selectAddress = useAppStore((s) => s.selectAddress);

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden bg-surface-gray">
      <div className="absolute inset-0 bg-ink/40" />
      <div className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl p-5 pb-8 sheet-up">
        <div className="w-9 h-1 rounded bg-border mx-auto mb-4" />
        <div className="flex justify-between items-center mb-4">
          <button type="button" onClick={() => navigate("/addresses/search")} className="flex items-center gap-1.5 text-accent font-semibold text-[13px]">
            <IconPlus size={16} /> افزودن آدرس
          </button>
          <span className="font-bold">انتخاب آدرس مغازه</span>
        </div>
        <button
          type="button"
          onClick={() => navigate("/addresses/search")}
          className="w-full bg-surface-gray rounded-xl px-3.5 py-3 flex items-center gap-2 mb-4 text-text-secondary min-h-11"
        >
          <IconSearch size={16} /> جستجوی آدرس، محله یا خیابان
        </button>
        <div className="max-h-72 overflow-y-auto">
          {addresses.length === 0 && <p className="text-sm text-text-secondary py-6 text-center">هنوز آدرسی ثبت نشده</p>}
          {addresses.map((addr) => (
            <button
              key={addr.id}
              type="button"
              onClick={async () => { await selectAddress(addr.id); navigate("/"); }}
              className="w-full flex items-center gap-3.5 py-3.5 border-b border-border text-right"
            >
              <span className={`w-[22px] h-[22px] rounded-full border-[2.5px] flex items-center justify-center ${selectedId === addr.id ? "border-accent" : "border-secondary"}`}>
                {selectedId === addr.id && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
              </span>
              <div className="flex-1">
                <div className="font-semibold flex items-center gap-1 justify-end">
                  <IconMapPin size={14} color="#8E8E93" /> {addr.title || "آدرس"}
                </div>
                <div className="text-[13px] text-text-secondary mt-1 truncate">{addr.fullAddress}</div>
              </div>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => navigate("/")} className="w-full mt-4 text-text-secondary text-sm">انصراف</button>
      </div>
    </div>
  );
}
