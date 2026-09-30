// Deterministic demo world for distributor d2 (توزیع و پخش البرز), the same distributor the
// admin demo account (سارا محمدی) manages in ../admin-FrontEnd.
import type { DeliveryItem, DeliveryStatus, DriverNotification, DriverProfile, DriverStop, OrderStatus } from "@/types";
import { daysAgo } from "@/lib/jalali";

export type DriverAccount = DriverProfile & { password: string; active: boolean };

export const DEMO_PASSWORD = "driver123";

export const SEED_DRIVERS: DriverAccount[] = [
  {
    id: "drv_1",
    username: "ali.rezaei",
    password: DEMO_PASSWORD,
    active: true,
    name: "علی رضایی",
    phone: "09121112233",
    distributorId: "d2",
    distributorName: "توزیع و پخش البرز",
    distributorPhone: "02632145500",
    vehicle: { type: "نیسان یخچال‌دار", plate: "۲۲ ب ۳۶۵ ایران ۶۸" },
  },
  {
    id: "drv_2",
    username: "reza.ahmadi",
    password: DEMO_PASSWORD,
    active: true,
    name: "رضا احمدی",
    phone: "09124445566",
    distributorId: "d2",
    distributorName: "توزیع و پخش البرز",
    distributorPhone: "02632145500",
    vehicle: { type: "وانت مزدا", plate: "۴۷ ج ۸۱۲ ایران ۲۱" },
  },
  {
    id: "drv_3",
    username: "hamid.nouri",
    password: DEMO_PASSWORD,
    active: false,
    name: "حمید نوری",
    phone: "09127778800",
    distributorId: "d2",
    distributorName: "توزیع و پخش البرز",
    distributorPhone: "02632145500",
    vehicle: null,
  },
];

/** Same names as ../admin-FrontEnd/src/services/seed/catalog.ts so an order reads identically in both apps. */
const PRODUCTS: Array<[string, string, number]> = [
  ["p1", "شیر پاستوریزه میهن ۱ لیتری", 12],
  ["p2", "ماست پاستوریزه کاله ۴۵۰ گرمی", 12],
  ["p3", "پنیر پیتزای رامک ۴۵۰ گرمی", 8],
  ["p4", "نوشابه کوکاکولا ۱.۵ لیتری", 12],
  ["p5", "کره حیوانی صباح ۱۰۰ گرمی", 24],
  ["p6", "آب معدنی دماوند ۱.۵ لیتری", 12],
  ["p7", "آبمیوه سیب طبیعی ۱ لیتری", 6],
];

type StopSeed = {
  shop: string;
  phone: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  items: Array<[number, number]>;
};

const SHOPS: StopSeed[] = [
  {
    shop: "سوپرمارکت آفتاب",
    phone: "09121110022",
    city: "تهران",
    address: "خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۱۲۴",
    lat: 35.7579,
    lng: 51.4096,
    items: [
      [0, 8],
      [1, 4],
      [3, 3],
    ],
  },
  {
    shop: "هایپر شهروند",
    phone: "09123334455",
    city: "کرج",
    address: "عظیمیه، میدان مهران، پلاک ۸",
    lat: 35.8327,
    lng: 50.9915,
    items: [
      [2, 6],
      [4, 2],
    ],
  },
  {
    shop: "سوپر گلها",
    phone: "09125556677",
    city: "تهران",
    address: "نارمک، میدان هفت‌حوض، پلاک ۱۹",
    lat: 35.7384,
    lng: 51.5053,
    items: [
      [0, 10],
      [5, 3],
      [6, 2],
    ],
  },
  {
    shop: "فروشگاه نوین",
    phone: "09127775544",
    city: "تهران",
    address: "پونک، بلوار عدل، نبش کوچه نسترن، پلاک ۱۲",
    lat: 35.7621,
    lng: 51.3319,
    items: [
      [1, 6],
      [2, 4],
      [3, 5],
      [4, 1],
    ],
  },
  {
    shop: "سوپرمارکت احمدی",
    phone: "09129990011",
    city: "تهران",
    address: "سعادت‌آباد، میدان کاج، خیابان سرو غربی، پلاک ۴۲",
    lat: 35.7806,
    lng: 51.3783,
    items: [
      [0, 12],
      [6, 4],
    ],
  },
  {
    shop: "مینی‌مارکت پارسا",
    phone: "09126668899",
    city: "تهران",
    address: "شهرک غرب، بلوار فرحزادی، پلاک ۷۷",
    lat: 35.7669,
    lng: 51.3632,
    items: [
      [3, 6],
      [5, 2],
    ],
  },
  {
    shop: "فروشگاه کوروش",
    phone: "09123217788",
    city: "کرج",
    address: "گوهردشت، بلوار موذن، پلاک ۱۵۰",
    lat: 35.8289,
    lng: 50.9471,
    items: [
      [0, 6],
      [1, 6],
      [2, 3],
    ],
  },
  {
    shop: "سوپرمارکت ستاره",
    phone: "09124443322",
    city: "کرج",
    address: "مهرشهر، بلوار ارم، پلاک ۳۱",
    lat: 35.8213,
    lng: 50.9105,
    items: [[4, 3]],
  },
];

type StopState = {
  status: DeliveryStatus;
  orderStatus: OrderStatus;
  closedReason?: DriverStop["closedReason"];
  submittedAt?: Date;
  confirmedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
};

export type SeedDelivery = DriverStop & {
  driverId: string;
  items: DeliveryItem[];
  instructions: string | null;
  code: string;
};

function buildItems(seed: StopSeed): DeliveryItem[] {
  return seed.items.map(([idx, qty]) => {
    const [id, name, unitsPerCarton] = PRODUCTS[idx];
    return { id, name, qty, unitsPerCarton };
  });
}

function stop(
  id: string,
  driverId: string,
  day: number,
  sequence: number,
  seed: StopSeed,
  orderNumber: string,
  code: string,
  state: StopState,
  instructions: string | null = null,
): SeedDelivery {
  const items = buildItems(seed);
  const assignedAt = day === 0 ? new Date(Date.now() - 240 * 60_000) : daysAgo(day, 7, 30);
  const updated = state.confirmedAt ?? state.rejectedAt ?? state.submittedAt ?? assignedAt;
  return {
    id,
    driverId,
    sequence,
    orderId: `ord_${id}`,
    orderNumber,
    orderStatus: state.orderStatus,
    status: state.status,
    closedReason: state.closedReason ?? null,
    shop: {
      name: seed.shop,
      phone: seed.phone,
      address: seed.address,
      city: seed.city,
      lat: seed.lat,
      lng: seed.lng,
    },
    deliveryDate: (day === 0 ? new Date() : daysAgo(day, 10)).toISOString(),
    deliverySlot: ["09:45", "10:15", "11:00", "11:45", "12:30", "14:00", "15:15", "16:45"][sequence - 1] ?? "17:30",
    itemsCount: items.length,
    cartons: items.reduce((s, i) => s + i.qty, 0),
    assignedAt: assignedAt.toISOString(),
    submittedAt: state.submittedAt?.toISOString() ?? null,
    confirmedAt: state.confirmedAt?.toISOString() ?? null,
    rejectedAt: state.rejectedAt?.toISOString() ?? null,
    rejectionReason: state.rejectionReason ?? null,
    updatedAt: updated.toISOString(),
    items,
    instructions,
    code,
  };
}

const confirmed = (day: number, h: number, m: number): StopState => ({
  status: "confirmed",
  orderStatus: "delivered",
  submittedAt: daysAgo(day, h, m),
  confirmedAt: daysAgo(day, h, m + 12),
});

/** Today's events are relative to "now" so the demo reads naturally at any hour. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const confirmedToday = (submittedMinsAgo: number): StopState => ({
  status: "confirmed",
  orderStatus: "delivered",
  submittedAt: ago(submittedMinsAgo),
  confirmedAt: ago(submittedMinsAgo - 12),
});

export const SEED_DELIVERIES: SeedDelivery[] = [
  // Today — ali.rezaei
  stop("dl_1", "drv_1", 0, 1, SHOPS[0], "VT-482311", "503118", confirmedToday(150)),
  stop("dl_2", "drv_1", 0, 2, SHOPS[1], "VT-482306", "771204", confirmedToday(95)),
  stop("dl_3", "drv_1", 0, 3, SHOPS[2], "VT-482298", "260947", {
    status: "awaiting_confirmation",
    orderStatus: "shipped",
    submittedAt: ago(22),
  }),
  stop(
    "dl_4",
    "drv_1",
    0,
    4,
    SHOPS[3],
    "VT-482290",
    "482615",
    { status: "assigned", orderStatus: "shipped" },
    "ورود از درب پشتی انبار. قبل از رسیدن با آقای کاظمی تماس بگیرید.",
  ),
  stop("dl_5", "drv_1", 0, 5, SHOPS[4], "VT-482284", "915372", { status: "assigned", orderStatus: "shipped" }),
  stop("dl_6", "drv_1", 0, 6, SHOPS[5], "VT-482277", "338061", { status: "assigned", orderStatus: "shipped" }),
  stop(
    "dl_7",
    "drv_1",
    0,
    7,
    SHOPS[6],
    "VT-482269",
    "649280",
    { status: "assigned", orderStatus: "packing" },
    "بار این سفارش هنوز در انبار آماده‌سازی می‌شود.",
  ),
  stop("dl_8", "drv_1", 0, 8, SHOPS[7], "VT-482261", "127594", {
    status: "cancelled",
    orderStatus: "cancelled",
    closedReason: "order_cancelled",
  }),

  // Yesterday
  stop("dl_y1", "drv_1", 1, 1, SHOPS[4], "VT-481977", "000000", confirmed(1, 9, 50)),
  stop("dl_y2", "drv_1", 1, 2, SHOPS[0], "VT-481970", "000000", confirmed(1, 10, 35)),
  stop("dl_y3", "drv_1", 1, 3, SHOPS[6], "VT-481962", "000000", {
    status: "rejected",
    orderStatus: "shipped",
    submittedAt: daysAgo(1, 11, 20),
    rejectedAt: daysAgo(1, 11, 58),
    rejectionReason: "مغایرت در تعداد کارتن‌های تحویلی؛ با انبار هماهنگ کنید.",
  }),
  stop("dl_y4", "drv_1", 1, 4, SHOPS[5], "VT-481955", "000000", confirmed(1, 12, 40)),
  stop("dl_y5", "drv_1", 1, 5, SHOPS[2], "VT-481949", "000000", {
    status: "cancelled",
    orderStatus: "shipped",
    closedReason: "reassigned",
  }),
  stop("dl_y6", "drv_1", 1, 6, SHOPS[1], "VT-481940", "000000", confirmed(1, 15, 5)),

  // Two days ago
  stop("dl_z1", "drv_1", 2, 1, SHOPS[3], "VT-481702", "000000", confirmed(2, 9, 30)),
  stop("dl_z2", "drv_1", 2, 2, SHOPS[7], "VT-481695", "000000", confirmed(2, 10, 45)),
  stop("dl_z3", "drv_1", 2, 3, SHOPS[0], "VT-481688", "000000", confirmed(2, 12, 10)),
  stop("dl_z4", "drv_1", 2, 4, SHOPS[6], "VT-481680", "000000", confirmed(2, 14, 25)),

  // Another driver of the same distributor — must never be visible to ali.rezaei
  stop("dl_r1", "drv_2", 0, 1, SHOPS[5], "VT-482250", "555111", { status: "assigned", orderStatus: "shipped" }),
];

const minsAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

export const SEED_NOTIFICATIONS: Array<DriverNotification & { driverId: string }> = [
  {
    id: "nt_1",
    driverId: "drv_1",
    kind: "order_cancelled",
    title: "سفارش لغو شد",
    body: "سفارش VT-482261 (سوپرمارکت ستاره) لغو شد و از مسیر امروز حذف شد.",
    deliveryId: "dl_8",
    createdAt: minsAgo(40).toISOString(),
    readAt: null,
  },
  {
    id: "nt_2",
    driverId: "drv_1",
    kind: "delivery_confirmed",
    title: "تحویل تایید شد",
    body: "تحویل سفارش VT-482306 به هایپر شهروند توسط مدیر تایید شد.",
    deliveryId: "dl_2",
    createdAt: minsAgo(83).toISOString(),
    readAt: null,
  },
  {
    id: "nt_3",
    driverId: "drv_1",
    kind: "route_updated",
    title: "ترتیب مسیر به‌روز شد",
    body: "مدیر ترتیب توقف‌های امروز را تغییر داد. فروشگاه نوین حالا توقف چهارم است.",
    deliveryId: "dl_4",
    createdAt: minsAgo(200).toISOString(),
    readAt: null,
  },
  {
    id: "nt_4",
    driverId: "drv_1",
    kind: "instruction",
    title: "دستورالعمل امروز",
    body: "کالاهای لبنی را تا لحظه تحویل در یخچال خودرو نگه دارید.",
    deliveryId: null,
    createdAt: minsAgo(235).toISOString(),
    readAt: minsAgo(225).toISOString(),
  },
  {
    id: "nt_5",
    driverId: "drv_1",
    kind: "task_assigned",
    title: "توزیع جدید تخصیص داده شد",
    body: "۸ سفارش برای امروز به مسیر شما اضافه شد.",
    deliveryId: null,
    createdAt: minsAgo(240).toISOString(),
    readAt: minsAgo(225).toISOString(),
  },
  {
    id: "nt_6",
    driverId: "drv_1",
    kind: "delivery_rejected",
    title: "تحویل رد شد",
    body: "تایید تحویل سفارش VT-481962 رد شد: مغایرت در تعداد کارتن‌های تحویلی.",
    deliveryId: "dl_y3",
    createdAt: daysAgo(1, 11, 58).toISOString(),
    readAt: daysAgo(1, 12, 10).toISOString(),
  },
  {
    id: "nt_7",
    driverId: "drv_1",
    kind: "assignment_removed",
    title: "سفارش به راننده دیگری سپرده شد",
    body: "سفارش VT-481949 (سوپر گلها) از مسیر شما برداشته شد.",
    deliveryId: "dl_y5",
    createdAt: daysAgo(1, 13, 15).toISOString(),
    readAt: daysAgo(1, 13, 30).toISOString(),
  },
];
