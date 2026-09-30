const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toAsciiDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function toFaNum(n: number) {
  return n.toLocaleString("fa-IR");
}

export function toFaDigits(value: string | number) {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function formatToman(n: number) {
  return `${toFaNum(n)} تومان`;
}

export function normalizePersian(s: string) {
  return s
    .replace(/[‌‍‎‏]/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/آ/g, "ا")
    .replace(/أ|إ/g, "ا")
    .toLowerCase();
}

export function nowLabel() {
  return "همین الان";
}

export function createId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
