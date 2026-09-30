import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PickupPin from "@/components/map/PickupPin";
import PinMap, { type PinMapHandle } from "@/components/map/PinMap";
import { IconChevronRight, IconCrosshair, IconMapPin, IconSearch } from "@/components/icons";
import { nearestCity, pinLabel } from "@/lib/geo";
import { useAppStore } from "@/store/useAppStore";

export default function MapPage() {
  const navigate = useNavigate();
  const draft = useAppStore((s) => s.draftPin);
  const setDraftPin = useAppStore((s) => s.setDraftPin);
  const mapRef = useRef<PinMapHandle>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState(draft ? pinLabel(draft.lat, draft.lng) : "موقعیت انتخابی");
  const [lifting, setLifting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [sheetH, setSheetH] = useState(220);
  const liftingRef = useRef(false);

  useEffect(() => {
    if (!draft) navigate("/addresses/search", { replace: true });
  }, [draft, navigate]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const sync = () => setSheetH(Math.ceil(sheet.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [draft]);

  if (!draft) return null;

  const confirm = () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    const city = nearestCity(center.lat, center.lng);
    setDraftPin({
      city: city.main,
      lat: center.lat,
      lng: center.lng,
      streetLabel: pinLabel(center.lat, center.lng),
    });
    navigate("/addresses/new");
  };

  const locate = () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      mapRef.current?.setView(pos.coords.latitude, pos.coords.longitude, 16);
    });
  };

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden bg-page">
      <PinMap
        ref={mapRef}
        lat={draft.lat}
        lng={draft.lng}
        zoom={16}
        bottomPadding={sheetH}
        onDragStart={() => {
          liftingRef.current = true;
          setDropping(false);
          setLifting(true);
        }}
        onMoveEnd={(lat, lng) => {
          setLabel(pinLabel(lat, lng));
          if (!liftingRef.current) return;
          liftingRef.current = false;
          setLifting(false);
          setDropping(true);
          window.setTimeout(() => setDropping(false), 280);
        }}
      >
        <PickupPin lifting={lifting} dropping={dropping} label={label} />
      </PinMap>

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="absolute right-4 top-[max(12px,env(safe-area-inset-top))] z-20 size-11 rounded-full bg-card text-accent shadow-[0_2px_14px_rgb(0_0_0/0.16)] flex items-center justify-center"
        aria-label="بازگشت"
      >
        <IconChevronRight />
      </button>

      <button
        type="button"
        onClick={locate}
        style={{ bottom: `${sheetH + 24}px` }}
        className="absolute left-4 z-20 size-12 rounded-full bg-card text-accent shadow-[0_2px_14px_rgb(0_0_0/0.16)] flex items-center justify-center"
        aria-label="موقعیت من"
      >
        <IconCrosshair />
      </button>

      <div
        ref={sheetRef}
        className="absolute bottom-0 inset-x-0 z-20 bg-card rounded-t-[28px] shadow-[0_-12px_40px_rgb(0_0_0/0.14)] px-5 pt-2 pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-fill" />
        <div className="text-[13px] text-text-secondary">مبدأ</div>
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => navigate("/addresses/search")}
            className="w-full min-h-12 rounded-2xl bg-neutral px-3.5 flex items-center gap-3"
          >
            <IconSearch />
            <span className="flex-1 text-right font-semibold text-[16px] truncate">{label}</span>
            <IconMapPin size={18} color="#8E8E93" />
          </button>
        </div>
        <p className="mt-2 text-[13px] text-text-secondary">نقشه را حرکت دهید تا موقعیت دقیق شود</p>
        <button
          type="button"
          onClick={confirm}
          className="w-full h-[54px] mt-4 rounded-[14px] bg-accent text-inverse font-semibold text-[17px]"
        >
          تایید مبدأ
        </button>
      </div>
    </div>
  );
}
