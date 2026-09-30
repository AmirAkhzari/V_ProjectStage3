import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { slotLabel, type DeliveryDay, type DeliverySlot, type DeliveryTimeSlot } from "@/lib/delivery";
import { api } from "@/services/client";
import type { SlotDay } from "@/services/api";
import { toFaDigits, toFaNum } from "@/lib/format";

export default function DeliverySlotSheet({
  distributorId,
  fee,
  saved,
  onClose,
  onSave,
}: {
  distributorId: string;
  fee: number | "free";
  saved: DeliverySlot | null;
  onClose: () => void;
  onSave: (slot: DeliverySlot) => void;
}) {
  const [days, setDays] = useState<SlotDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayKey, setDayKey] = useState(saved?.dayKey ?? "");
  const [time, setTime] = useState(saved?.time ?? "");

  useEffect(() => {
    let live = true;
    setLoading(true);
    void api.getSlots(distributorId).then((next) => {
      if (!live) return;
      setDays(next);
      const firstOpen = next.find((day) => day.available) ?? next[0];
      const savedOpen = Boolean(saved && next.some((day) => day.key === saved.dayKey && day.available));
      setDayKey(savedOpen && saved ? saved.dayKey : firstOpen?.key ?? "");
      setTime(savedOpen && saved ? saved.time : "");
      setLoading(false);
    }).catch(() => {
      if (live) {
        setDays([]);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [distributorId, saved]);

  const selectedDay = days.find((day) => day.key === dayKey) ?? days.find((day) => day.available) ?? days[0];
  const slots: DeliveryTimeSlot[] = selectedDay?.times ?? [];

  const confirm = () => {
    if (!selectedDay || !time || !selectedDay.available) return;
    onSave({
      distributorId,
      dayKey: selectedDay.key,
      dayTitle: selectedDay.title,
      dateLabel: selectedDay.dateLabel,
      time,
      label: slotLabel(selectedDay, time),
    });
  };

  return (
    <div className="absolute inset-0 z-50 bg-ink/55 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-page rounded-t-[22px] max-h-[88%] flex flex-col overflow-hidden shadow-floating" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-center text-[17px] font-semibold">انتخاب زمان ارسال</h2>
          <p className="text-center text-[12px] text-text-secondary mt-1.5">احتمال دارد ۱۵ دقیقه زودتر یا دیرتر تحویل داده شود.</p>
        </div>

        <div className="flex overflow-x-auto no-scrollbar border-b border-separator px-2 shrink-0">
          {days.map((day) => (
            <DayTab
              key={day.key}
              day={day}
              active={day.key === selectedDay?.key}
              onClick={() => {
                if (!day.available) return;
                setDayKey(day.key);
                setTime("");
              }}
            />
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
          {loading && <p className="text-center text-[13px] text-text-secondary py-8">در حال بارگذاری بازه‌ها...</p>}
          {!loading && slots.length === 0 && (
            <p className="text-center text-[13px] text-text-secondary py-8">برای این روز بازه تحویل فعالی نمانده است.</p>
          )}
          {slots.map((slot) => {
            const active = time === slot.time;
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => setTime(slot.time)}
                className={`w-full rounded-[16px] bg-card border px-4 py-3.5 flex items-center justify-between ${active ? "border-accent" : "border-separator"}`}
              >
                <span className="text-right">
                  <span className="block text-[16px] font-semibold tabular-nums">{toFaDigits(slot.time)}</span>
                  <span className="block text-[12px] text-text-secondary mt-0.5">
                    {fee === "free" ? "ارسال رایگان" : `${toFaNum(fee)} تومان`}
                  </span>
                </span>
                <span className={`size-5 rounded-full border flex items-center justify-center ${active ? "border-accent" : "border-gray-5"}`}>
                  {active ? <span className="size-2.5 rounded-full bg-accent" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-4 pt-2 pb-5 shrink-0">
          <Button disabled={!time} onClick={confirm}>تایید و ذخیره</Button>
          <button type="button" onClick={onClose} className="w-full h-11 mt-1 text-text-secondary">بازگشت</button>
        </div>
      </div>
    </div>
  );
}

function DayTab({ day, active, onClick }: { day: DeliveryDay; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={!day.available}
      onClick={onClick}
      className={`min-w-[88px] px-3 py-2.5 text-center shrink-0 ${day.available ? "" : "opacity-40"} ${active ? "border-b-2 border-accent" : ""}`}
    >
      <div className="text-[15px] font-semibold">{day.title}</div>
      <div className="text-[11px] text-text-secondary mt-0.5">{day.dateLabel}</div>
    </button>
  );
}
