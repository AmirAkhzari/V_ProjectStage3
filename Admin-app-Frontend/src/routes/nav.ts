import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Boxes,
  ClipboardList,
  Clock,
  CreditCard,
  Crown,
  History,
  IdCard,
  Image,
  LayoutDashboard,
  MapPin,
  Package,
  PackageCheck,
  Settings,
  Store,
  Ticket,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import type { Permission } from "@/types";
import { paths } from "./paths";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  perm?: Permission | Permission[];
  badge?: "pendingOrders" | "awaitingDeliveries";
  end?: boolean;
};
export type NavGroup = { label?: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    items: [
      {
        label: "داشبورد",
        to: paths.dashboard,
        icon: LayoutDashboard,
        perm: "dashboard.view",
        end: true,
      },
      {
        label: "سفارش‌ها",
        to: paths.orders,
        icon: ClipboardList,
        perm: "orders.view",
        badge: "pendingOrders",
      },
      {
        label: "محصولات",
        to: paths.products,
        icon: Package,
        perm: "products.view",
      },
      {
        label: "موجودی و قیمت",
        to: paths.stock,
        icon: Boxes,
        perm: "stock.view",
      },
      {
        label: "شرکت‌های پخش",
        to: paths.distributors,
        icon: Truck,
        perm: "distributors.view",
      },
      {
        label: "فروشگاه‌ها",
        to: paths.retailers,
        icon: Store,
        perm: "retailers.view",
      },
    ],
  },
  {
    label: "بازاریابی",
    items: [
      {
        label: "کدهای تخفیف",
        to: paths.coupons,
        icon: Ticket,
        perm: "coupons.view",
      },
      {
        label: "بنرها",
        to: paths.banners,
        icon: Image,
        perm: "banners.manage",
      },
      {
        label: "پیام‌ها",
        to: paths.messages,
        icon: Bell,
        perm: "messages.send",
      },
    ],
  },
  {
    label: "مالی",
    items: [
      {
        label: "پرداخت‌ها",
        to: paths.payments,
        icon: CreditCard,
        perm: "finance.view",
      },
      {
        label: "کیف پول‌ها",
        to: paths.wallets,
        icon: Wallet,
        perm: "finance.view",
      },
      {
        label: "اشتراک‌ها",
        to: paths.subscriptions,
        icon: Crown,
        perm: "subscriptions.manage",
      },
    ],
  },
  {
    label: "ارسال",
    items: [
      {
        label: "تایید تحویل‌ها",
        to: paths.deliveries,
        icon: PackageCheck,
        perm: "deliveries.confirm",
        badge: "awaitingDeliveries",
      },
      {
        label: "رانندگان",
        to: paths.drivers,
        icon: IdCard,
        perm: "drivers.view",
      },
      {
        label: "بازه‌های تحویل",
        to: paths.slots,
        icon: Clock,
        perm: "delivery.manage",
      },
      {
        label: "شهرها",
        to: paths.cities,
        icon: MapPin,
        perm: "settings.manage",
      },
    ],
  },
  {
    label: "تنظیمات",
    items: [
      {
        label: "عمومی",
        to: paths.settings,
        icon: Settings,
        perm: "settings.manage",
      },
      { label: "کارکنان", to: paths.staff, icon: Users, perm: "staff.manage" },
      {
        label: "گزارش فعالیت",
        to: paths.audit,
        icon: History,
        perm: "audit.view",
      },
    ],
  },
];

export function findNavLabel(pathname: string) {
  for (const group of NAV) {
    for (const item of group.items) {
      if (item.end ? pathname === item.to : pathname.startsWith(item.to)) return item.label;
    }
  }
  return null;
}
