import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  daysInJalaliMonth,
  formatJalali,
  JALALI_WEEKDAYS_SHORT,
  jalaliMonthLabel,
  jalaliWeekday,
  toGregorian,
  toJalali,
  type JalaliDate,
} from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Value is an ISO date (YYYY-MM-DD) or null. */
export default function JalaliDatePicker({
  value,
  onChange,
  placeholder = "انتخاب تاریخ",
  className,
  clearable = true,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  className?: string;
  clearable?: boolean;
}) {
  const selected = value ? new Date(value) : null;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<JalaliDate>(() => toJalali(selected ?? new Date()));

  const grid = useMemo(() => {
    const first = toGregorian({ ...view, day: 1 });
    const offset = jalaliWeekday(first);
    const count = daysInJalaliMonth(view.year, view.month);
    const cells: Array<JalaliDate | null> = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= count; d++) cells.push({ ...view, day: d });
    return cells;
  }, [view]);

  const move = (delta: number) => {
    let month = view.month + delta;
    let year = view.year;
    if (month > 12) {
      month = 1;
      year++;
    }
    if (month < 1) {
      month = 12;
      year--;
    }
    setView({ year, month, day: 1 });
  };

  const isSame = (a: Date | null, b: JalaliDate) => {
    if (!a) return false;
    const j = toJalali(a);
    return j.year === b.year && j.month === b.month && j.day === b.day;
  };
  const today = new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 items-center gap-2 rounded-xl bg-input px-3.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            !selected && "text-label-tertiary",
            className,
          )}
        >
          <CalendarDays className="size-4 text-label-secondary" />
          <span className="flex-1 text-right">{selected ? formatJalali(selected) : placeholder}</span>
          {selected && clearable ? (
            <span
              role="button"
              tabIndex={-1}
              className="rounded p-0.5 text-label-secondary hover:bg-fill"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              <X className="size-3.5" />
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="icon-sm" onClick={() => move(-1)} aria-label="ماه قبل">
            <ChevronRight />
          </Button>
          <span className="text-[13px] font-semibold">{jalaliMonthLabel(view)}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => move(1)} aria-label="ماه بعد">
            <ChevronLeft />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {JALALI_WEEKDAYS_SHORT.map((w) => (
            <span key={w} className="py-1 text-[11px] text-label-tertiary">
              {w}
            </span>
          ))}
          {grid.map((cell, i) =>
            cell ? (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const g = toGregorian(cell);
                  onChange(
                    `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, "0")}-${String(g.getDate()).padStart(2, "0")}`,
                  );
                  setOpen(false);
                }}
                className={cn(
                  "h-8 rounded-lg text-[12px] tabular-nums hover:bg-fill",
                  isSame(selected, cell) && "bg-primary text-primary-foreground hover:bg-primary",
                  !isSame(selected, cell) && isSame(today, cell) && "font-bold underline underline-offset-4",
                )}
              >
                {toFaNum(cell.day)}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
