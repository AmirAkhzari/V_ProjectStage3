import { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import { toFaNum } from "@/lib/format";

const MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
const WEEK = ["ش","ی","د","س","چ","پ","ج"];
const DATA = [
  { year: 1405, month: 5, days: 31, offset: 2 },
  { year: 1405, month: 6, days: 30, offset: 5 },
];
const UNAVAILABLE: Record<number, number[]> = { 0: [26, 29], 1: [5, 12] };
const TODAY = 21;

export default function JalaliCalendar({ onClose, onConfirm }: { onClose: () => void; onConfirm: (label: string) => void }) {
  const [mi, setMi] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const { year, month, days, offset } = DATA[mi];
  const cells: Array<{ day: number; past: boolean; unavailable: boolean } | null> = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, past: mi === 0 && d <= TODAY, unavailable: (UNAVAILABLE[mi] ?? []).includes(d) });
  while (cells.length % 7) cells.push(null);

  const tap = (day: number, past: boolean, unavailable: boolean) => {
    if (past || unavailable || checking) return;
    setSelected(day);
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      onConfirm(`${toFaNum(day)} ${MONTHS[month]} ${toFaNum(year)}`);
    }, 700);
  };

  return (
    <div className="absolute inset-0 z-40 bg-ink/55 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-card rounded-t-[22px] p-4 pb-7 sheet-up" onClick={(e) => e.stopPropagation()}>
        <div className="w-9 h-1 rounded bg-border mx-auto mb-4" />
        <div className="flex items-center justify-between mb-3">
          <button type="button" disabled={mi >= DATA.length - 1} onClick={() => setMi((m) => m + 1)} className="w-9 h-9 rounded-[10px] bg-brand-tint flex items-center justify-center"><IconChevronLeft size={18} /></button>
          <span className="font-extrabold">{MONTHS[month]} {toFaNum(year)}</span>
          <button type="button" disabled={mi <= 0} onClick={() => setMi((m) => m - 1)} className="w-9 h-9 rounded-[10px] bg-brand-tint flex items-center justify-center"><IconChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-bold text-text-secondary mb-1">
          {WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => cell ? (
            <button
              key={i}
              type="button"
              onClick={() => tap(cell.day, cell.past, cell.unavailable)}
              className={`h-10 rounded-[10px] text-[13px] ${selected === cell.day ? "bg-accent text-inverse font-extrabold" : cell.past ? "opacity-30" : cell.unavailable ? "line-through text-text-secondary" : ""}`}
            >
              {toFaNum(cell.day)}
            </button>
          ) : <div key={i} />)}
        </div>
        {checking && <p className="mt-3 text-[13px] text-accent bg-brand-tint rounded-xl p-3">در حال بررسی موجودیت...</p>}
      </div>
    </div>
  );
}
