// Ported from ../FrontEnd/src/lib/phone.ts
import { toAsciiDigits } from "./format";

export function normalizePhone(raw: string) {
  let value = toAsciiDigits(raw).replace(/[^\d]/g, "");
  if (value.startsWith("0098")) value = `0${value.slice(4)}`;
  if (value.startsWith("98")) value = `0${value.slice(2)}`;
  if (value.startsWith("9") && value.length === 10) value = `0${value}`;
  return value;
}

export function isValidIranMobile(raw: string) {
  return /^09\d{9}$/.test(normalizePhone(raw));
}

export function formatPhoneDisplay(raw: string) {
  const phone = normalizePhone(raw);
  return phone.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
