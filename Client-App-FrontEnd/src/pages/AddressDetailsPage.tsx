import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BackHeader from "@/components/layout/BackHeader";
import PickupPin from "@/components/map/PickupPin";
import PinMap from "@/components/map/PinMap";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import Button from "@/components/ui/Button";
import TextField from "@/components/ui/TextField";
import { IconStore } from "@/components/icons";
import { useAppStore } from "@/store/useAppStore";
import type { AddressTag } from "@/types";

export default function AddressDetailsPage() {
  const navigate = useNavigate();
  const draft = useAppStore((s) => s.draftPin);
  const saveAddress = useAppStore((s) => s.saveAddress);
  const setToast = useAppStore((s) => s.setToast);
  const [fullAddr, setFullAddr] = useState(draft?.streetLabel ?? "");
  const [unit, setUnit] = useState("");
  const [plaque, setPlaque] = useState("");
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState<AddressTag | null>("store");
  const [branchName, setBranchName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft) {
      navigate("/addresses/search", { replace: true });
      return;
    }
    if (!fullAddr.trim() || !plaque.trim()) {
      setError("آدرس کامل و پلاک الزامی است");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveAddress({
        title: title || (tag === "store" ? "فروشگاه اصلی" : tag === "warehouse" ? "انبار" : branchName || "شعبه"),
        fullAddress: fullAddr,
        plaque,
        unit,
        tag,
        branchName,
        city: draft.city,
        lat: draft.lat,
        lng: draft.lng,
        streetLabel: draft.streetLabel,
      });
      setToast("آدرس ثبت شد");
      navigate("/addresses", { replace: true });
    } catch (err) {
      const network = err instanceof Error && /failed to fetch|network/i.test(err.message);
      setError(network ? "ارتباط با سرور برقرار نشد. دوباره تلاش کنید." : "ثبت آدرس انجام نشد. دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  };

  const tags: { key: AddressTag; label: string }[] = [
    { key: "store", label: "فروشگاه اصلی" },
    { key: "warehouse", label: "انبار" },
    { key: "branch", label: "شعبه" },
  ];

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto bg-surface-gray">
      {saving && <BrandedWaitScreen overlay />}
      <BackHeader title="جزئیات آدرس" />
      <div className="h-44 relative bg-page">
        {draft && (
          <PinMap lat={draft.lat} lng={draft.lng} zoom={16} interactive={false}>
            <PickupPin compact />
          </PinMap>
        )}
        <button type="button" onClick={() => navigate("/addresses/map")} className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-accent text-inverse text-[13px] font-semibold px-4 min-h-11 rounded-full shadow-[0_8px_20px_rgb(0_0_0/0.18)]">
          ویرایش موقعیت مکانی
        </button>
      </div>
      <div className="p-4 pb-8">
        <div className="bg-card rounded-2xl border border-border p-4 mb-3">
          <label className="text-[13px] font-semibold">آدرس کامل <span className="text-error">*</span></label>
          <textarea value={fullAddr} onChange={(e) => setFullAddr(e.target.value)} className="w-full mt-2 min-h-[72px] rounded-xl border border-secondary/50 bg-neutral p-3 outline-none focus:border-accent" />
          <div className="flex gap-2.5 mt-3">
            <div className="flex-1">
              <label className="text-[13px] font-semibold">واحد</label>
              <TextField className="mt-1.5" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="واحد" />
            </div>
            <div className="flex-1">
              <label className="text-[13px] font-semibold">پلاک <span className="text-error">*</span></label>
              <TextField className="mt-1.5" value={plaque} onChange={(e) => setPlaque(e.target.value)} placeholder="پلاک" />
            </div>
          </div>
          <label className="text-[13px] font-semibold mt-3 block">عنوان آدرس</label>
          <TextField className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان دلخواه شما (اختیاری)" />
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 mb-5">
          <div className="text-[13px] text-text-secondary mb-2.5">نوع آدرس</div>
          <div className="flex gap-2">
            {tags.map((t) => (
              <button key={t.key} type="button" onClick={() => setTag(t.key)} className={`flex-1 h-[52px] rounded-xl border-2 text-[12px] ${tag === t.key ? "border-accent bg-brand-tint text-accent" : "border-border bg-neutral text-secondary"}`}>
                <span className="flex flex-col items-center gap-1"><IconStore color={tag === t.key ? "currentColor" : "#8E8E93"} />{t.label}</span>
              </button>
            ))}
          </div>
          {tag === "branch" && <TextField className="mt-3" value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="نام شعبه را وارد کنید" />}
        </div>
        {error && <p className="text-error text-sm mb-3">{error}</p>}
        <Button type="button" loading={saving} onClick={save}>ثبت آدرس</Button>
      </div>
    </div>
  );
}
