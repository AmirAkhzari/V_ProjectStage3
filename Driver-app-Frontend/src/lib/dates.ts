import { formatJalali, formatTime } from "./jalali";
import { toFaDigits } from "./format";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** "امروز" / "دیروز" / "سه‌شنبه ۱ مهر" */
export function dayLabel(iso: string, now = new Date()) {
  const diff = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (diff === 0) return "امروز";
  if (diff === 1) return "دیروز";
  return formatJalali(iso, { withYear: false, withWeekday: true });
}

export function dayKey(iso: string) {
  return new Date(startOfDay(new Date(iso))).toISOString();
}

/** Backend slots are "HH:MM" (ASCII). */
export function slotLabel(slot: string) {
  return toFaDigits(slot);
}

export { formatTime };
