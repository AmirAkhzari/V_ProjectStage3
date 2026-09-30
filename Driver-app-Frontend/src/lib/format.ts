// Ported from ../FrontEnd/src/lib/format.ts
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

export function formatCompactToman(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${toFaDigits((n / 1_000_000_000).toFixed(1).replace(/\.0$/, ""))} میلیارد`;
  if (abs >= 1_000_000) return `${toFaDigits((n / 1_000_000).toFixed(1).replace(/\.0$/, ""))} میلیون`;
  if (abs >= 1_000) return `${toFaDigits(Math.round(n / 1_000))} هزار`;
  return toFaNum(n);
}

export function formatPercent(n: number, digits = 0) {
  return `${toFaDigits(n.toFixed(digits))}٪`;
}

export function formatMultiplier(n: number) {
  return `×${toFaDigits(n.toFixed(2))}`;
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

export function createId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}
