// Driver demo world. Distributor d2 mirrors ../Driver-FrontEnd/src/services/seed.ts
// (same drivers, order numbers and delivery states) so both demos tell the same story.
import type {
  Address,
  AdminNotification,
  Delivery,
  DeliveryStatus,
  Driver,
  Order,
  OrderEvent,
  OrderStatus,
  Retailer,
} from "@/types";
import { daysAgo } from "@/lib/jalali";
import { SEED_DISTRIBUTORS, SEED_PRODUCTS } from "./catalog";
import { SEED_ADDRESSES, SEED_ORDERS, SEED_RETAILERS } from "./orders";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const ADMIN_D2 = "سارا محمدی";

export const SEED_DRIVERS: Driver[] = [
  {
    id: "drv_1",
    distributorId: "d2",
    username: "ali.rezaei",
    name: "علی رضایی",
    phone: "09121112233",
    vehicle: { type: "نیسان یخچال‌دار", plate: "۲۲ ب ۳۶۵ ایران ۶۸" },
    active: true,
    createdAt: daysAgo(120).toISOString(),
    lastLoginAt: ago(250).toISOString(),
    passwordUpdatedAt: daysAgo(120).toISOString(),
  },
  {
    id: "drv_2",
    distributorId: "d2",
    username: "reza.ahmadi",
    name: "رضا احمدی",
    phone: "09124445566",
    vehicle: { type: "وانت مزدا", plate: "۴۷ ج ۸۱۲ ایران ۲۱" },
    active: true,
    createdAt: daysAgo(80).toISOString(),
    lastLoginAt: ago(190).toISOString(),
    passwordUpdatedAt: daysAgo(30).toISOString(),
  },
  {
    id: "drv_3",
    distributorId: "d2",
    username: "hamid.nouri",
    name: "حمید نوری",
    phone: "09127778800",
    vehicle: null,
    active: false,
    createdAt: daysAgo(200).toISOString(),
    lastLoginAt: daysAgo(45, 16, 20).toISOString(),
    passwordUpdatedAt: daysAgo(200).toISOString(),
  },
  {
    id: "drv_4",
    distributorId: "d1",
    username: "mehdi.ghasemi",
    name: "مهدی قاسمی",
    phone: "09141239876",
    vehicle: { type: "کامیونت ایسوزو", plate: "۱۵ د ۴۴۱ ایران ۱۵" },
    active: true,
    createdAt: daysAgo(150).toISOString(),
    lastLoginAt: ago(300).toISOString(),
    passwordUpdatedAt: daysAgo(150).toISOString(),
  },
  {
    id: "drv_5",
    distributorId: "d4",
    username: "saeed.kazemi",
    name: "سعید کاظمی",
    phone: "09122223344",
    vehicle: { type: "نیسان", plate: "۶۳ س ۲۱۹ ایران ۱۰" },
    active: true,
    createdAt: daysAgo(60).toISOString(),
    lastLoginAt: daysAgo(1, 18, 5).toISOString(),
    passwordUpdatedAt: daysAgo(60).toISOString(),
  },
];

type ShopSeed = [id: string, name: string, phone: string, city: string, street: string, lat: number, lng: number];

const EXTRA_SHOPS: ShopSeed[] = [
  [
    "r13",
    "سوپرمارکت احمدی",
    "09129990011",
    "تهران",
    "سعادت‌آباد، میدان کاج، خیابان سرو غربی، پلاک ۴۲",
    35.7806,
    51.3783,
  ],
  ["r14", "مینی‌مارکت پارسا", "09126668899", "تهران", "شهرک غرب، بلوار فرحزادی، پلاک ۷۷", 35.7669, 51.3632],
  ["r15", "فروشگاه کوروش", "09123217788", "کرج", "گوهردشت، بلوار موذن، پلاک ۱۵۰", 35.8289, 50.9471],
  ["r16", "سوپرمارکت ستاره", "09124443322", "کرج", "مهرشهر، بلوار ارم، پلاک ۳۱", 35.8213, 50.9105],
];

export const DRIVER_DEMO_RETAILERS: Retailer[] = EXTRA_SHOPS.map(([id, name, phone, city], i) => ({
  id,
  name,
  phone,
  city,
  status: "active",
  createdAt: daysAgo(90 - i * 11).toISOString(),
  walletBalance: 0,
  primaryDistributorId: "d2",
  primaryDistributorName: "توزیع و پخش البرز",
  plan: "free",
  subscriptionExpiresAt: null,
}));

export const DRIVER_DEMO_ADDRESSES: Address[] = EXTRA_SHOPS.map(([id, , , city, street, lat, lng]) => ({
  id: `addr_${id.slice(1)}`,
  retailerId: id,
  title: "فروشگاه اصلی",
  fullAddress: `${city}، ${street}`,
  plaque: street.match(/پلاک (\S+)/)?.[1] ?? "۱",
  unit: "۱",
  tag: "store",
  city,
  lat,
  lng,
  streetLabel: street.split("،")[0],
}));

const ALL_RETAILERS = [...SEED_RETAILERS, ...DRIVER_DEMO_RETAILERS];
const ALL_ADDRESSES = [...SEED_ADDRESSES, ...DRIVER_DEMO_ADDRESSES];

const PRODUCT_NAMES = [
  "شیر پاستوریزه میهن ۱ لیتری",
  "ماست پاستوریزه کاله ۴۵۰ گرمی",
  "پنیر پیتزای رامک ۴۵۰ گرمی",
  "نوشابه کوکاکولا ۱.۵ لیتری",
  "کره حیوانی صباح ۱۰۰ گرمی",
  "آب معدنی دماوند ۱.۵ لیتری",
  "آبمیوه سیب طبیعی ۱ لیتری",
];

const PIPELINE: OrderStatus[] = ["pending", "confirmed", "packing", "shipped", "delivered"];

function buildEvents(status: OrderStatus, createdAt: Date, deliveredNote?: string, deliveredAt?: Date): OrderEvent[] {
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
    events.push({
      id: `ev_${createdAt.getTime()}_1`,
      status: "confirmed",
      at: new Date(createdAt.getTime() + 40 * 60_000).toISOString(),
      actorName: ADMIN_D2,
    });
    events.push({
      id: `ev_${createdAt.getTime()}_c`,
      status: "cancelled",
      at: ago(40).toISOString(),
      actorName: ADMIN_D2,
      note: "درخواست فروشگاه",
    });
    return events;
  }
  const idx = PIPELINE.indexOf(status);
  for (let i = 1; i <= idx; i++) {
    const at = i === 4 && deliveredAt ? deliveredAt : new Date(createdAt.getTime() + i * 55 * 60_000);
    events.push({
      id: `ev_${createdAt.getTime()}_${i}`,
      status: PIPELINE[i],
      at: at.toISOString(),
      actorName: ADMIN_D2,
      note: i === 4 ? deliveredNote : undefined,
    });
  }
  return events;
}

type DemoStop = {
  delivery: string;
  driverId: string;
  seq: number;
  number: string;
  retailerId: string;
  day: number;
  orderStatus: OrderStatus;
  status: DeliveryStatus;
  items: Array<[number, number]>;
  submittedMinsAgo?: number;
  confirmedMinsAgo?: number;
  closedReason?: Delivery["closedReason"];
  rejectionReason?: string;
  failedAttempts?: number;
};

const SLOTS = ["09:45", "10:15", "11:00", "11:45", "12:30", "14:00", "15:15", "16:45"];

const DEMO_STOPS: DemoStop[] = [
  // Today — علی رضایی (same as the driver app demo)
  {
    delivery: "dl_1",
    driverId: "drv_1",
    seq: 1,
    number: "VT-482311",
    retailerId: "r2",
    day: 0,
    orderStatus: "delivered",
    status: "confirmed",
    items: [
      [0, 8],
      [1, 4],
      [3, 3],
    ],
    submittedMinsAgo: 150,
    confirmedMinsAgo: 138,
  },
  {
    delivery: "dl_2",
    driverId: "drv_1",
    seq: 2,
    number: "VT-482306",
    retailerId: "r3",
    day: 0,
    orderStatus: "delivered",
    status: "confirmed",
    items: [
      [2, 6],
      [4, 2],
    ],
    submittedMinsAgo: 95,
    confirmedMinsAgo: 83,
  },
  {
    delivery: "dl_3",
    driverId: "drv_1",
    seq: 3,
    number: "VT-482298",
    retailerId: "r6",
    day: 0,
    orderStatus: "shipped",
    status: "awaiting_confirmation",
    items: [
      [0, 10],
      [5, 3],
      [6, 2],
    ],
    submittedMinsAgo: 22,
  },
  {
    delivery: "dl_4",
    driverId: "drv_1",
    seq: 4,
    number: "VT-482290",
    retailerId: "r12",
    day: 0,
    orderStatus: "shipped",
    status: "assigned",
    items: [
      [1, 6],
      [2, 4],
      [3, 5],
      [4, 1],
    ],
  },
  {
    delivery: "dl_5",
    driverId: "drv_1",
    seq: 5,
    number: "VT-482284",
    retailerId: "r13",
    day: 0,
    orderStatus: "shipped",
    status: "assigned",
    items: [
      [0, 12],
      [6, 4],
    ],
    failedAttempts: 1,
  },
  {
    delivery: "dl_6",
    driverId: "drv_1",
    seq: 6,
    number: "VT-482277",
    retailerId: "r14",
    day: 0,
    orderStatus: "shipped",
    status: "assigned",
    items: [
      [3, 6],
      [5, 2],
    ],
  },
  {
    delivery: "dl_7",
    driverId: "drv_1",
    seq: 7,
    number: "VT-482269",
    retailerId: "r15",
    day: 0,
    orderStatus: "packing",
    status: "assigned",
    items: [
      [0, 6],
      [1, 6],
      [2, 3],
    ],
  },
  {
    delivery: "dl_8",
    driverId: "drv_1",
    seq: 8,
    number: "VT-482261",
    retailerId: "r16",
    day: 0,
    orderStatus: "cancelled",
    status: "cancelled",
    items: [[4, 3]],
    closedReason: "order_cancelled",
  },
  // Today — رضا احمدی
  {
    delivery: "dl_r1",
    driverId: "drv_2",
    seq: 1,
    number: "VT-482250",
    retailerId: "r14",
    day: 0,
    orderStatus: "shipped",
    status: "assigned",
    items: [
      [3, 6],
      [5, 2],
    ],
  },
  {
    delivery: "dl_r2",
    driverId: "drv_2",
    seq: 2,
    number: "VT-482244",
    retailerId: "r2",
    day: 0,
    orderStatus: "shipped",
    status: "awaiting_confirmation",
    items: [
      [1, 5],
      [6, 3],
    ],
    submittedMinsAgo: 8,
  },
  // Yesterday — علی رضایی
  {
    delivery: "dl_y1",
    driverId: "drv_1",
    seq: 1,
    number: "VT-481977",
    retailerId: "r13",
    day: 1,
    orderStatus: "delivered",
    status: "confirmed",
    items: [[0, 6]],
    submittedMinsAgo: 1440 + 300,
    confirmedMinsAgo: 1440 + 288,
  },
  {
    delivery: "dl_y2",
    driverId: "drv_1",
    seq: 2,
    number: "VT-481970",
    retailerId: "r2",
    day: 1,
    orderStatus: "delivered",
    status: "confirmed",
    items: [
      [1, 4],
      [3, 2],
    ],
    submittedMinsAgo: 1440 + 250,
    confirmedMinsAgo: 1440 + 240,
  },
  {
    delivery: "dl_y3",
    driverId: "drv_1",
    seq: 3,
    number: "VT-481962",
    retailerId: "r15",
    day: 1,
    orderStatus: "shipped",
    status: "rejected",
    items: [
      [0, 6],
      [2, 3],
    ],
    submittedMinsAgo: 1440 + 200,
    rejectionReason: "مغایرت در تعداد کارتن‌های تحویلی؛ با انبار هماهنگ کنید.",
  },
  {
    delivery: "dl_y4",
    driverId: "drv_1",
    seq: 4,
    number: "VT-481955",
    retailerId: "r14",
    day: 1,
    orderStatus: "delivered",
    status: "confirmed",
    items: [[3, 6]],
    submittedMinsAgo: 1440 + 120,
    confirmedMinsAgo: 1440 + 110,
  },
  {
    delivery: "dl_y5",
    driverId: "drv_1",
    seq: 5,
    number: "VT-481949",
    retailerId: "r6",
    day: 1,
    orderStatus: "delivered",
    status: "cancelled",
    items: [[0, 10]],
    closedReason: "reassigned",
  },
  {
    delivery: "dl_y5b",
    driverId: "drv_2",
    seq: 3,
    number: "VT-481949",
    retailerId: "r6",
    day: 1,
    orderStatus: "delivered",
    status: "confirmed",
    items: [[0, 10]],
    submittedMinsAgo: 1440 + 60,
    confirmedMinsAgo: 1440 + 45,
  },
  {
    delivery: "dl_y6",
    driverId: "drv_1",
    seq: 6,
    number: "VT-481940",
    retailerId: "r3",
    day: 1,
    orderStatus: "delivered",
    status: "confirmed",
    items: [[4, 2]],
    submittedMinsAgo: 1440 + 30,
    confirmedMinsAgo: 1440 + 20,
  },
];

/** Orders ready for assignment (no driver yet) so the Orders screen can demo the selector. */
const UNASSIGNED: Array<{ number: string; retailerId: string; status: OrderStatus; items: Array<[number, number]> }> = [
  {
    number: "VT-482239",
    retailerId: "r16",
    status: "packing",
    items: [
      [4, 3],
      [1, 2],
    ],
  },
  { number: "VT-482233", retailerId: "r13", status: "confirmed", items: [[0, 8]] },
  {
    number: "VT-482228",
    retailerId: "r3",
    status: "shipped",
    items: [
      [3, 4],
      [5, 4],
    ],
  },
];

function productByName(name: string) {
  return SEED_PRODUCTS.find((p) => p.name === name) ?? SEED_PRODUCTS[0];
}

function makeOrder(
  id: string,
  number: string,
  retailerId: string,
  day: number,
  status: OrderStatus,
  itemSpec: Array<[number, number]>,
  slot: string,
  deliveredNote?: string,
  deliveredAt?: Date,
): Order {
  const d2 = SEED_DISTRIBUTORS.find((d) => d.id === "d2")!;
  const retailer = ALL_RETAILERS.find((r) => r.id === retailerId)!;
  const address = ALL_ADDRESSES.find((a) => a.retailerId === retailerId)!;
  const items = itemSpec.map(([idx, qty]) => {
    const p = productByName(PRODUCT_NAMES[idx]);
    return {
      id: p.id,
      name: p.name,
      price: Math.round(p.price * d2.priceMultiplier),
      img: p.img,
      unitsPerCarton: p.unitsPerCarton,
      qty,
    };
  });
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const createdAt = day === 0 ? ago(60 * 20) : daysAgo(day + 1, 18, 10);
  return {
    id,
    number,
    status,
    createdAt: createdAt.toISOString(),
    deliveryDate: (day === 0 ? new Date() : daysAgo(day, 10)).toISOString(),
    deliverySlot: slot,
    subtotal,
    discount: 0,
    deliveryFee: 0,
    total: subtotal,
    distributorId: "d2",
    distributorName: d2.name,
    retailerId,
    retailerName: retailer.name,
    retailerPhone: retailer.phone,
    addressLabel: address.fullAddress,
    city: retailer.city,
    items,
    paymentMethod: "wallet",
    paymentStatus: "success",
    events: buildEvents(status, createdAt, deliveredNote, deliveredAt),
    cancelReason: status === "cancelled" ? "درخواست فروشگاه" : undefined,
  };
}

const driverName = (id: string) => SEED_DRIVERS.find((d) => d.id === id)!.name;

export const DRIVER_DEMO_ORDERS: Order[] = [
  ...[...new Map(DEMO_STOPS.map((s) => [s.number, s])).values()].map((s) => {
    const confirmedStop = DEMO_STOPS.find((x) => x.number === s.number && x.status === "confirmed");
    return makeOrder(
      `ord_${s.number}`,
      s.number,
      s.retailerId,
      s.day,
      s.orderStatus,
      s.items,
      SLOTS[s.seq - 1],
      confirmedStop ? `تایید تحویل با کد — راننده ${driverName(confirmedStop.driverId)}` : undefined,
      confirmedStop?.confirmedMinsAgo ? ago(confirmedStop.confirmedMinsAgo) : undefined,
    );
  }),
  ...UNASSIGNED.map((u, i) => makeOrder(`ord_${u.number}`, u.number, u.retailerId, 0, u.status, u.items, SLOTS[i + 2])),
];

function deliveryFrom(s: DemoStop): Delivery {
  const order = DRIVER_DEMO_ORDERS.find((o) => o.number === s.number)!;
  return {
    id: s.delivery,
    orderId: order.id,
    orderNumber: order.number,
    distributorId: order.distributorId,
    driverId: s.driverId,
    driverName: driverName(s.driverId),
    sequence: s.seq,
    status: s.status,
    closedReason: s.closedReason ?? null,
    retailerName: order.retailerName,
    city: order.city,
    addressLabel: order.addressLabel,
    deliveryDate: order.deliveryDate,
    deliverySlot: order.deliverySlot,
    cartons: order.items.reduce((sum, i) => sum + i.qty, 0),
    orderStatus: order.status,
    assignedAt: (s.day === 0 ? ago(240) : daysAgo(s.day, 7, 30)).toISOString(),
    assignedByName: ADMIN_D2,
    submittedAt: s.submittedMinsAgo ? ago(s.submittedMinsAgo).toISOString() : null,
    confirmedAt: s.confirmedMinsAgo ? ago(s.confirmedMinsAgo).toISOString() : null,
    confirmedByName: s.confirmedMinsAgo ? ADMIN_D2 : null,
    rejectedAt: s.rejectionReason ? ago((s.submittedMinsAgo ?? 0) - 38).toISOString() : null,
    rejectedByName: s.rejectionReason ? ADMIN_D2 : null,
    rejectionReason: s.rejectionReason ?? null,
    failedAttempts: s.failedAttempts ?? 0,
  };
}

/** Other tenants: a few of the existing generated orders get drivers so SuperAdmin sees cross-tenant data. */
function otherTenantDeliveries(): Delivery[] {
  const out: Delivery[] = [];
  for (const [distributorId, driverId] of [
    ["d1", "drv_4"],
    ["d4", "drv_5"],
  ] as const) {
    const orders = SEED_ORDERS.filter(
      (o) => o.distributorId === distributorId && (o.status === "shipped" || o.status === "packing"),
    ).slice(0, 3);
    orders.forEach((o, i) => {
      const verified = i === 0 && o.status === "shipped";
      out.push({
        id: `dl_${driverId}_${i + 1}`,
        orderId: o.id,
        orderNumber: o.number,
        distributorId,
        driverId,
        driverName: driverName(driverId),
        sequence: i + 1,
        status: verified ? "awaiting_confirmation" : "assigned",
        closedReason: null,
        retailerName: o.retailerName,
        city: o.city,
        addressLabel: o.addressLabel,
        deliveryDate: o.deliveryDate,
        deliverySlot: o.deliverySlot,
        cartons: o.items.reduce((s, it) => s + it.qty, 0),
        orderStatus: o.status,
        assignedAt: ago(300).toISOString(),
        assignedByName: "مدیر شرکت پخش",
        submittedAt: verified ? ago(35).toISOString() : null,
        confirmedAt: null,
        confirmedByName: null,
        rejectedAt: null,
        rejectedByName: null,
        rejectionReason: null,
        failedAttempts: 0,
      });
    });
  }
  return out;
}

export const SEED_DELIVERIES: Delivery[] = [...DEMO_STOPS.map(deliveryFrom), ...otherTenantDeliveries()];

export const SEED_ADMIN_NOTIFICATIONS: AdminNotification[] = SEED_DELIVERIES.filter(
  (d) => d.status === "awaiting_confirmation",
).map((d) => ({
  id: `an_${d.id}`,
  kind: "delivery_verified",
  distributorId: d.distributorId,
  deliveryId: d.id,
  orderId: d.orderId,
  orderNumber: d.orderNumber,
  retailerName: d.retailerName,
  driverName: d.driverName,
  at: d.submittedAt!,
  readAt: null,
}));
