// Deterministic demo world: retailers, addresses, orders, payments, wallets, audit log.
import type {
  Address,
  AuditEntry,
  DeliverySlotConfig,
  Order,
  OrderEvent,
  OrderStatus,
  Payment,
  Retailer,
  RetailerSubscription,
  WalletAccount,
  WalletTransaction,
} from "@/types";
import { PRO_MONTHLY_PRICE } from "@/types";
import { SEED_DISTRIBUTORS, SEED_PRODUCTS, SEED_STOCK } from "./catalog";
import { SEED_CITIES } from "./cities";
import { SEED_STAFF } from "./staff";
import { daysAgo } from "@/lib/jalali";

/** Small seeded PRNG (mulberry32) so the demo world is stable across reloads. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260920);
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const RETAILER_SEED: Array<[string, string, string, string]> = [
  ["فروشگاه ملحمی", "09143662051", "تبریز", "نیروی هوایی، گجیل، پلاک ۲۴"],
  ["سوپرمارکت آفتاب", "09121110022", "تهران", "خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۱۲۴"],
  ["هایپر شهروند", "09123334455", "کرج", "عظیمیه، میدان مهران، پلاک ۸"],
  ["فروشگاه برادران رضایی", "09131234567", "اصفهان", "خیابان چهارباغ بالا، کوچه ۱۲، پلاک ۳"],
  ["مینی‌مارکت نگین", "09149876543", "تبریز", "ولیعصر، فلکه بزرگ، پلاک ۵۶"],
  ["سوپر گلها", "09125556677", "تهران", "نارمک، میدان هفت‌حوض، پلاک ۱۹"],
  ["فروشگاه زنجیره‌ای رفاه شهریار", "09120001122", "شهریار", "بلوار انقلاب، پلاک ۲۰۱"],
  ["سوپرمارکت سهند", "09141112233", "مراغه", "خیابان خواجه نصیر، پلاک ۴۴"],
  ["فروشگاه امید", "09144455667", "خوی", "خیابان امام، بازار سرپوشیده، پلاک ۷"],
  ["هایپر پارس", "09133221100", "نجف‌آباد", "خیابان شریعتی، پلاک ۶۵"],
  ["سوپرمارکت یاس", "09126667788", "اسلامشهر", "خیابان کاشانی، پلاک ۹۰"],
  ["فروشگاه نوین", "09127775544", "تهران", "پونک، بلوار عدل، پلاک ۱۲"],
];

const PRIMARY_BY_RETAILER: Record<string, string> = {
  r1: "d1",
  r2: "d2",
  r3: "d2",
  r4: "d8",
  r5: "d1",
  r6: "d4",
  r7: "d4",
  r8: "d1",
  r9: "d5",
  r10: "d8",
  r11: "d4",
  r12: "d7",
};

const PRO_RETAILERS = new Set(["r1", "r4", "r12"]);
const PRO_EXPIRES: Record<string, string> = {
  r1: daysAgo(-20).toISOString(),
  r4: daysAgo(-5).toISOString(),
  r12: daysAgo(-25).toISOString(),
};

function distributorName(id: string) {
  return SEED_DISTRIBUTORS.find((d) => d.id === id)?.name ?? null;
}

export const SEED_RETAILERS: Retailer[] = RETAILER_SEED.map(([name, phone, city], i) => {
  const id = `r${i + 1}`;
  const primaryDistributorId = PRIMARY_BY_RETAILER[id] ?? null;
  const pro = PRO_RETAILERS.has(id);
  return {
    id,
    name,
    phone,
    city,
    status: i === 10 ? "blocked" : "active",
    createdAt: daysAgo(400 - i * 27).toISOString(),
    walletBalance: i === 0 ? 185_000 : between(0, 12) * 50_000,
    primaryDistributorId,
    primaryDistributorName: primaryDistributorId ? distributorName(primaryDistributorId) : null,
    plan: pro ? "pro" : "free",
    subscriptionExpiresAt: pro ? (PRO_EXPIRES[id] ?? null) : null,
  };
});

export const SEED_SUBSCRIPTIONS: RetailerSubscription[] = [
  {
    id: "sub_1",
    retailerId: "r1",
    plan: "pro",
    status: "active",
    startsAt: daysAgo(10).toISOString(),
    expiresAt: PRO_EXPIRES.r1,
    paymentId: "pay_sub_1",
    createdAt: daysAgo(10).toISOString(),
    updatedAt: daysAgo(10).toISOString(),
  },
  {
    id: "sub_2",
    retailerId: "r2",
    plan: "pro",
    status: "expired",
    startsAt: daysAgo(60).toISOString(),
    expiresAt: daysAgo(30).toISOString(),
    paymentId: "pay_sub_2",
    createdAt: daysAgo(60).toISOString(),
    updatedAt: daysAgo(30).toISOString(),
  },
  {
    id: "sub_4",
    retailerId: "r4",
    plan: "pro",
    status: "active",
    startsAt: daysAgo(25).toISOString(),
    expiresAt: PRO_EXPIRES.r4,
    paymentId: "pay_sub_4",
    createdAt: daysAgo(25).toISOString(),
    updatedAt: daysAgo(25).toISOString(),
  },
  {
    id: "sub_6",
    retailerId: "r6",
    plan: "pro",
    status: "cancelled",
    startsAt: daysAgo(40).toISOString(),
    expiresAt: daysAgo(-20).toISOString(),
    paymentId: null,
    createdAt: daysAgo(40).toISOString(),
    updatedAt: daysAgo(12).toISOString(),
  },
  {
    id: "sub_12",
    retailerId: "r12",
    plan: "pro",
    status: "active",
    startsAt: daysAgo(5).toISOString(),
    expiresAt: PRO_EXPIRES.r12,
    paymentId: "pay_sub_12",
    createdAt: daysAgo(5).toISOString(),
    updatedAt: daysAgo(5).toISOString(),
  },
];

export const SEED_ADDRESSES: Address[] = RETAILER_SEED.map(([, , city, street], i) => {
  const c = SEED_CITIES.find((x) => x.name === city) ?? SEED_CITIES[0];
  return {
    id: `addr_${i + 1}`,
    retailerId: `r${i + 1}`,
    title: "فروشگاه اصلی",
    fullAddress: `${city}، ${street}`,
    plaque: street.match(/پلاک (\S+)/)?.[1] ?? "۱",
    unit: "۱",
    tag: "store",
    city,
    lat: c.lat + (rand() - 0.5) * 0.06,
    lng: c.lng + (rand() - 0.5) * 0.06,
    streetLabel: street.split("،")[0],
  };
});

const STATUS_WEIGHTS: Array<[OrderStatus, number]> = [
  ["pending", 14],
  ["confirmed", 9],
  ["packing", 6],
  ["shipped", 8],
  ["delivered", 52],
  ["cancelled", 11],
];

function weightedStatus(ageDays: number): OrderStatus {
  if (ageDays > 6) return rand() < 0.88 ? "delivered" : "cancelled";
  const total = STATUS_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [status, w] of STATUS_WEIGHTS) {
    r -= w;
    if (r <= 0) return status;
  }
  return "delivered";
}

const PIPELINE: OrderStatus[] = ["pending", "confirmed", "packing", "shipped", "delivered"];

function buildEvents(status: OrderStatus, createdAt: Date, actor: string): OrderEvent[] {
  const events: OrderEvent[] = [
    {
      id: `ev_${createdAt.getTime()}_0`,
      status: "pending",
      at: createdAt.toISOString(),
      actorName: "سیستم",
      note: "سفارش توسط فروشگاه ثبت شد",
    },
  ];
  if (status === "cancelled") {
    const at = new Date(createdAt.getTime() + between(20, 300) * 60_000);
    events.push({
      id: `ev_${createdAt.getTime()}_c`,
      status: "cancelled",
      at: at.toISOString(),
      actorName: actor,
      note: pick(["عدم موجودی کالا", "درخواست فروشگاه", "خارج از محدوده ارسال"]),
    });
    return events;
  }
  const idx = PIPELINE.indexOf(status);
  let cursor = createdAt.getTime();
  for (let i = 1; i <= idx; i++) {
    cursor += between(25, 480) * 60_000;
    events.push({
      id: `ev_${createdAt.getTime()}_${i}`,
      status: PIPELINE[i],
      at: new Date(cursor).toISOString(),
      actorName: i === 4 ? "راننده توزیع" : actor,
    });
  }
  return events;
}

const SLOTS = ["۰۹:۴۵", "۱۰:۱۵", "۱۱:۰۰", "۱۲:۳۰", "۱۴:۰۰", "۱۵:۱۵", "۱۶:۴۵", "۱۸:۰۰"];

export const SEED_ORDERS: Order[] = (() => {
  const orders: Order[] = [];
  let seq = 482193;
  for (let i = 0; i < 64; i++) {
    const retailer = SEED_RETAILERS[i % SEED_RETAILERS.length];
    const address = SEED_ADDRESSES.find((a) => a.retailerId === retailer.id)!;
    const serving = SEED_DISTRIBUTORS.filter((d) => d.cities.includes(retailer.city));
    const distributor = serving.length ? pick(serving) : SEED_DISTRIBUTORS[0];
    const stocked = SEED_STOCK.filter((s) => s.distributorId === distributor.id && s.available).map((s) => s.productId);
    const pool = SEED_PRODUCTS.filter((p) => stocked.includes(p.id) && p.active);
    const count = between(1, Math.min(5, pool.length));
    const chosen = [...pool].sort(() => rand() - 0.5).slice(0, count);
    const items = chosen.map((p) => ({
      id: p.id,
      name: p.name,
      price: Math.round(p.price * distributor.priceMultiplier),
      img: p.img,
      unitsPerCarton: p.unitsPerCarton,
      qty: between(p.minOrderQty, p.minOrderQty + 9),
    }));
    let subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    if (subtotal < 500_000) {
      items[0].qty += Math.ceil((500_000 - subtotal) / items[0].price);
      subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    }
    const ageDays = i < 6 ? 0 : i < 14 ? between(1, 2) : between(2, 30);
    const createdAt = daysAgo(ageDays, between(8, 19), between(0, 59));
    const status = weightedStatus(ageDays);
    const coupon = rand() < 0.22 ? (distributor.id === "d2" ? "ALBORZ50" : "VISIT12") : undefined;
    const discount = coupon === "ALBORZ50" ? 50_000 : coupon === "VISIT12" ? Math.round(subtotal * 0.12) : 0;
    const deliveryFee = distributor.deliveryFee === "free" ? 0 : distributor.deliveryFee;
    const deliveryDate = new Date(createdAt.getTime() + between(1, 3) * 86_400_000);
    const staff = SEED_STAFF.find((s) => s.distributorId === distributor.id) ?? SEED_STAFF[0];
    seq -= between(90, 460);
    orders.push({
      id: `ord_${i + 1}`,
      number: `VT-${seq}`,
      status,
      createdAt: createdAt.toISOString(),
      deliveryDate: deliveryDate.toISOString(),
      deliverySlot: pick(SLOTS),
      subtotal,
      discount,
      deliveryFee,
      total: subtotal - discount + deliveryFee,
      distributorId: distributor.id,
      distributorName: distributor.name,
      retailerId: retailer.id,
      retailerName: retailer.name,
      retailerPhone: retailer.phone,
      addressLabel: address.fullAddress,
      city: retailer.city,
      items,
      paymentMethod: rand() < 0.35 ? "wallet" : "gateway",
      paymentStatus: status === "cancelled" && rand() < 0.4 ? "failed" : "success",
      couponCode: coupon,
      events: buildEvents(status, createdAt, staff.name),
      cancelReason: undefined,
    });
  }
  // Pin the three orders the client demo shows.
  orders[0] = {
    ...orders[0],
    number: "VT-482193",
    status: "pending",
    retailerId: "r1",
    retailerName: "فروشگاه ملحمی",
    retailerPhone: "09143662051",
    distributorId: "d2",
    distributorName: "توزیع و پخش البرز",
    city: "تبریز",
    addressLabel: SEED_ADDRESSES[0].fullAddress,
    events: buildEvents("pending", new Date(orders[0].createdAt), "سارا محمدی"),
  };
  orders[1] = {
    ...orders[1],
    number: "VT-471002",
    status: "delivered",
    retailerId: "r1",
    retailerName: "فروشگاه ملحمی",
    retailerPhone: "09143662051",
    distributorId: "d1",
    distributorName: "شرکت پخش ایران",
    city: "تبریز",
    addressLabel: SEED_ADDRESSES[0].fullAddress,
    events: buildEvents("delivered", new Date(orders[1].createdAt), "رضا کریمی"),
  };
  orders[2] = {
    ...orders[2],
    number: "VT-460881",
    status: "cancelled",
    retailerId: "r1",
    retailerName: "فروشگاه ملحمی",
    retailerPhone: "09143662051",
    distributorId: "d1",
    distributorName: "شرکت پخش ایران",
    city: "تبریز",
    addressLabel: SEED_ADDRESSES[0].fullAddress,
    events: buildEvents("cancelled", new Date(orders[2].createdAt), "رضا کریمی"),
  };
  for (const o of orders) {
    if (o.status === "cancelled") o.cancelReason = o.events.at(-1)?.note;
  }
  return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
})();

export const SEED_PAYMENTS: Payment[] = (() => {
  const payments: Payment[] = SEED_ORDERS.map((o, i) => ({
    id: `pay_o_${i + 1}`,
    kind: "order",
    retailerId: o.retailerId,
    retailerName: o.retailerName,
    amount: o.total,
    method: o.paymentMethod,
    status: o.paymentStatus,
    createdAt: o.createdAt,
    orderNumber: o.number,
    distributorId: o.distributorId,
  }));
  SEED_RETAILERS.forEach((r, i) => {
    if (i % 3 === 0) return;
    payments.push({
      id: `pay_w_${i + 1}`,
      kind: "wallet",
      retailerId: r.id,
      retailerName: r.name,
      amount: between(2, 20) * 50_000,
      method: "gateway",
      status: rand() < 0.9 ? "success" : "failed",
      createdAt: daysAgo(between(0, 25), between(9, 20), between(0, 59)).toISOString(),
    });
  });
  const subPays: Payment[] = [
    {
      id: "pay_sub_1",
      kind: "subscription",
      retailerId: "r1",
      retailerName: "فروشگاه ملحمی",
      amount: PRO_MONTHLY_PRICE,
      method: "gateway",
      status: "success",
      createdAt: daysAgo(10).toISOString(),
    },
    {
      id: "pay_sub_2",
      kind: "subscription",
      retailerId: "r2",
      retailerName: "سوپرمارکت آفتاب",
      amount: PRO_MONTHLY_PRICE,
      method: "gateway",
      status: "success",
      createdAt: daysAgo(60).toISOString(),
    },
    {
      id: "pay_sub_4",
      kind: "subscription",
      retailerId: "r4",
      retailerName: "فروشگاه برادران رضایی",
      amount: PRO_MONTHLY_PRICE,
      method: "gateway",
      status: "success",
      createdAt: daysAgo(25).toISOString(),
    },
    {
      id: "pay_sub_12",
      kind: "subscription",
      retailerId: "r12",
      retailerName: "فروشگاه نوین",
      amount: PRO_MONTHLY_PRICE,
      method: "gateway",
      status: "success",
      createdAt: daysAgo(5).toISOString(),
    },
  ];
  return [...payments, ...subPays].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
})();

export const SEED_WALLETS: WalletAccount[] = SEED_RETAILERS.map((r) => {
  const tx: WalletTransaction[] = SEED_PAYMENTS.filter((p) => p.kind === "wallet" && p.retailerId === r.id).map(
    (p) => ({
      id: `tx_${p.id}`,
      amount: p.amount,
      createdAt: p.createdAt,
      status: p.status === "failed" ? "failed" : "success",
      kind: "topup",
    }),
  );
  SEED_ORDERS.filter(
    (o) => o.retailerId === r.id && o.paymentMethod === "wallet" && o.paymentStatus === "success",
  ).forEach((o) => {
    tx.push({
      id: `tx_ord_${o.id}`,
      amount: -o.total,
      createdAt: o.createdAt,
      status: "success",
      kind: "order",
      note: o.number,
    });
  });
  if (r.id === "r1")
    tx.push({
      id: "tx_demo",
      amount: 185_000,
      createdAt: daysAgo(15, 11, 0).toISOString(),
      status: "success",
      kind: "topup",
    });
  return {
    retailerId: r.id,
    retailerName: r.name,
    phone: r.phone,
    balance: r.walletBalance,
    transactions: tx.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
});

const DEFAULT_SLOTS = [
  "09:45",
  "10:15",
  "10:45",
  "11:15",
  "11:45",
  "12:15",
  "12:45",
  "13:15",
  "13:45",
  "14:15",
  "14:45",
  "15:15",
  "15:45",
  "16:15",
  "16:45",
  "17:15",
  "17:45",
  "18:15",
  "18:45",
];

export const SEED_SLOTS: DeliverySlotConfig[] = SEED_DISTRIBUTORS.map((d, i) => ({
  distributorId: d.id,
  days: Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      day,
      day === 6
        ? i % 2 === 0
          ? []
          : DEFAULT_SLOTS.slice(0, 6)
        : day === 5
          ? DEFAULT_SLOTS.slice(0, 10)
          : DEFAULT_SLOTS,
    ]),
  ),
  holidays: [daysAgo(-12).toISOString().slice(0, 10)],
}));

export const SEED_AUDIT: AuditEntry[] = SEED_ORDERS.flatMap((o) =>
  o.events
    .filter((e) => e.status !== "pending")
    .map((e) => ({
      id: `au_${e.id}`,
      at: e.at,
      actorId: SEED_STAFF.find((s) => s.name === e.actorName)?.id ?? "system",
      actorName: e.actorName,
      action: `تغییر وضعیت سفارش ${o.number} به «${
        e.status === "confirmed"
          ? "تایید شده"
          : e.status === "packing"
            ? "در حال بسته‌بندی"
            : e.status === "shipped"
              ? "ارسال شده"
              : e.status === "delivered"
                ? "تحویل شده"
                : "لغو شده"
      }»`,
      entity: "order",
      entityId: o.id,
    })),
).sort((a, b) => b.at.localeCompare(a.at));
