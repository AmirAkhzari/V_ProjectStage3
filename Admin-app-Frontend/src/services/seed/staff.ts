import type { Staff } from "@/types";
import { ROLE_LABELS } from "@/lib/permissions";
import { daysAgo } from "@/lib/jalali";

export const DEMO_SUPER_ADMIN_PHONE = "09143662051";
export const DEMO_DISTRIBUTOR_ADMIN_PHONE = "09121234567";

export const SEED_STAFF: Staff[] = [
  {
    id: "st_1",
    name: "امیر رضایی",
    phone: DEMO_SUPER_ADMIN_PHONE,
    role: "super_admin",
    roleLabel: ROLE_LABELS.super_admin,
    lastLoginAt: daysAgo(0, 9, 12).toISOString(),
    active: true,
  },
  {
    id: "st_2",
    name: "سارا محمدی",
    phone: DEMO_DISTRIBUTOR_ADMIN_PHONE,
    role: "distributor_admin",
    roleLabel: ROLE_LABELS.distributor_admin,
    distributorId: "d2",
    lastLoginAt: daysAgo(0, 8, 40).toISOString(),
    active: true,
  },
  {
    id: "st_3",
    name: "رضا کریمی",
    phone: "09131112233",
    role: "distributor_admin",
    roleLabel: "اپراتور سفارش‌ها",
    distributorId: "d1",
    lastLoginAt: daysAgo(1, 17, 5).toISOString(),
    active: true,
  },
  {
    id: "st_4",
    name: "لیلا آذری",
    phone: "09144445566",
    role: "distributor_admin",
    roleLabel: ROLE_LABELS.distributor_admin,
    distributorId: "d5",
    lastLoginAt: daysAgo(3, 11, 30).toISOString(),
    active: true,
  },
  {
    id: "st_5",
    name: "هومن تهرانی",
    phone: "09127778899",
    role: "distributor_admin",
    roleLabel: ROLE_LABELS.distributor_admin,
    distributorId: "d7",
    lastLoginAt: daysAgo(12, 14, 0).toISOString(),
    active: false,
  },
];
