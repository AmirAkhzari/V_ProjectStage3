import { toFaDigits, toFaNum } from "@/lib/format";

export const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const JALALI_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
export const JALALI_TODAY = { year: 1405, month: 6, day: 27, weekday: 6 };

const MONTH_DAYS = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
const SLOT_START = 9 * 60 + 45;
const SLOT_END = 18 * 60 + 45;
const SLOT_STEP = 30;

export type DeliveryDay = {
  key: string;
  offset: number;
  title: string;
  dateLabel: string;
  available: boolean;
};

export type DeliveryTimeSlot = {
  id: string;
  time: string;
  minutes: number;
};

export type DeliverySlot = {
  distributorId: string;
  dayKey: string;
  dayTitle: string;
  dateLabel: string;
  time: string;
  label: string;
};

export function daysInJalaliMonth(month: number) {
  return MONTH_DAYS[month - 1] ?? 30;
}

export function addJalaliDays(base: typeof JALALI_TODAY, offset: number) {
  let year = base.year;
  let month = base.month;
  let day = base.day + offset;
  while (day > daysInJalaliMonth(month)) {
    day -= daysInJalaliMonth(month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return {
    year,
    month,
    day,
    weekday: (base.weekday + offset) % 7,
  };
}

export function formatClock(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function clockMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

export function timeSlots(nowMinutes: number, isToday: boolean): DeliveryTimeSlot[] {
  const slots: DeliveryTimeSlot[] = [];
  for (let minutes = SLOT_START; minutes <= SLOT_END; minutes += SLOT_STEP) {
    if (isToday && minutes <= nowMinutes + 15) continue;
    const time = formatClock(minutes);
    slots.push({ id: time, time, minutes });
  }
  return slots;
}

export function deliveryDays(nowMinutes = clockMinutes(), count = 7): DeliveryDay[] {
  return Array.from({ length: count }, (_, offset) => {
    const date = addJalaliDays(JALALI_TODAY, offset);
    const title = offset === 0 ? "امروز" : offset === 1 ? "فردا" : JALALI_WEEKDAYS[date.weekday];
    const available = offset === 0 ? timeSlots(nowMinutes, true).length > 0 : true;
    return {
      key: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
      offset,
      title,
      dateLabel: `${toFaNum(date.day)} ${JALALI_MONTHS[date.month - 1]}`,
      available,
    };
  });
}

export function slotLabel(day: DeliveryDay, time: string) {
  return `${day.title} ${day.dateLabel}، ساعت ${toFaDigits(time)}`;
}

export function storeSlotNotice(slot: DeliverySlot) {
  return `ارسال سفارش شما، برای ${slot.dayTitle} ساعت ${toFaDigits(slot.time)} تنظیم شد.`;
}
