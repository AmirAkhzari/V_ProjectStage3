// Jalali (Persian) calendar helpers. Conversion algorithm: Kazimierz Borkowski.
import { toFaDigits, toFaNum } from "./format";

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];
export const JALALI_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
export const JALALI_WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export type JalaliDate = { year: number; month: number; day: number };

function div(a: number, b: number) {
  return Math.trunc(a / b);
}

export function toJalali(date: Date): JalaliDate {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gDaysInMonth[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { year: jy, month: jm, day: jd };
}

export function toGregorian(j: JalaliDate): Date {
  const jy = j.year + 1595;
  let days =
    -355668 +
    365 * jy +
    div(jy, 33) * 8 +
    div((jy % 33) + 3, 4) +
    j.day +
    (j.month < 7 ? (j.month - 1) * 31 : (j.month - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > monthDays[gm]; gm++) gd -= monthDays[gm];
  return new Date(gy, gm - 1, gd);
}

export function daysInJalaliMonth(year: number, month: number) {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return isJalaliLeap(year) ? 30 : 29;
}

export function isJalaliLeap(year: number) {
  const r = (((year - 474) % 2820) + 2820) % 2820;
  return ((r + 474 + 38) * 682) % 2816 < 682;
}

/** 0 = شنبه … 6 = جمعه */
export function jalaliWeekday(date: Date) {
  return (date.getDay() + 1) % 7;
}

export function formatJalali(input: string | Date, opts: { withYear?: boolean; withWeekday?: boolean } = {}) {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  const j = toJalali(date);
  const base = `${toFaNum(j.day)} ${JALALI_MONTHS[j.month - 1]}${
    opts.withYear === false ? "" : ` ${toFaDigits(j.year)}`
  }`;
  return opts.withWeekday ? `${JALALI_WEEKDAYS[jalaliWeekday(date)]} ${base}` : base;
}

export function formatJalaliShort(input: string | Date) {
  return formatJalali(input, { withYear: false });
}

export function formatTime(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  return toFaDigits(`${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`);
}

export function formatJalaliDateTime(input: string | Date) {
  return `${formatJalali(input, { withYear: false })}، ${formatTime(input)}`;
}

export function relativeLabel(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "همین الان";
  if (mins < 60) return `${toFaNum(mins)} دقیقه پیش`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${toFaNum(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${toFaNum(days)} روز پیش`;
  return formatJalali(date, { withYear: false });
}

export function jalaliMonthLabel(j: JalaliDate) {
  return `${JALALI_MONTHS[j.month - 1]} ${toFaDigits(j.year)}`;
}

export function daysAgo(n: number, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function daysAhead(n: number) {
  return daysAgo(-n);
}
