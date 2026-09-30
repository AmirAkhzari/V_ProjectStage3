# Figma Make Prompt — ویزیتور Admin Panel

> Copy everything below the line into Figma Make. It is self-contained: Figma Make does not see this repo, so all tokens, sample data and screen specs are inlined.
> Companion docs: `docs/BUILD_PLAN.md` (architecture), `AGENTS.md` (conventions).

---

Build a **desktop-first, RTL Persian admin dashboard** called **ویزیتور — پنل مدیریت** for a B2B wholesale ordering platform. Shop owners (retailers) use a mobile PWA to order full cartons from distribution companies (شرکت پخش). This admin panel is the back office for that platform.

Use **React + TypeScript + Tailwind CSS v4 + shadcn/ui (Radix, RTL enabled) + lucide-react icons + Recharts**. Single-page app with client-side routing. Produce real, navigable screens with realistic Persian sample data — not placeholders or lorem ipsum.

## 1. Design language (must match the existing client app exactly)

The client app follows Apple iOS Human Interface Guidelines semantics, monochrome, very restrained. Reuse these tokens verbatim.

**Direction & language**: `<html lang="fa" dir="rtl">`. All UI text in Persian. All numbers rendered with **Farsi digits** (۰۱۲۳۴۵۶۷۸۹), thousands separated with `٬`, currency suffix `تومان`. Dates in the **Jalali (Persian) calendar**, e.g. `۲۳ شهریور ۱۴۰۵`.

**Typography**: font family `IRANSansXFaNum`, fallback `Vazirmatn`, then `Tahoma, system-ui, sans-serif`. Weights 400/500/600/700. Body 14px, table text 13px, page title 22px semibold, KPI value 28px bold. Farsi digits come from the font (do not use tabular Latin digits).

**Colors — light theme**

- page background (grouped): `#F2F2F7`
- card / sidebar / popover: `#FFFFFF`
- label primary (text, accent, primary button bg): `#000000`
- label secondary: `rgba(60,60,67,0.60)`
- label tertiary: `rgba(60,60,67,0.30)`
- fill (muted bg, secondary button bg, hover): `rgba(118,118,128,0.12)`
- fill secondary: `rgba(118,118,128,0.16)`
- separator: `rgba(0,0,0,0.12)`
- destructive / error / alert only: `#FF3B30`
- chart ramp (gray): `#DEDEDE`, `#8E8E93`, `#6E6E73`, `#5A5A5E`, `#3A3A3C`

**Colors — dark theme** (toggle via `data-theme="dark"` on `<html>`)

- page background: `#000000`
- card / sidebar: `#1C1C1E`
- label primary: `#FFFFFF`
- label secondary: `rgba(235,235,245,0.60)`
- label tertiary: `rgba(235,235,245,0.30)`
- fill: `rgba(118,118,128,0.36)`
- separator: `rgba(255,255,255,0.16)`
- destructive: `#FF453A`

**Rules**

- The accent color is **label primary (black in light, white in dark)**. Primary buttons are black with white text. No blue, no brand purple, no gradients.
- Red is used **only** for destructive actions, errors, and alert badges (e.g. low stock, cancelled).
- Status badges are monochrome pills: filled black pill for the active/selected state, `fill` pill with primary text for neutral states; cancelled uses red text on a red-tinted fill.
- Radius: cards `10px`, buttons/inputs `12–14px`, pills `999px`. No drop shadows on cards (flat, separated by background contrast). Hairline separators only.
- Buttons: height 40px in dense admin contexts, 50px for primary form actions. Active press state = opacity 0.64.
- Generous whitespace; dense but calm tables. Think Apple Settings + Linear, not a colorful SaaS template.

## 2. Layout shell

- **Right-side sidebar** (RTL), 264px expanded, 64px collapsed (icon-only with tooltips). Background = card color, hairline left border. Logo/wordmark "ویزیتور" at top, nav groups in the middle, user card at the bottom (avatar initials, name, role, sign-out menu).
- **Top bar** (56px): breadcrumb on the right, then on the left: global search input with `⌘K` hint that opens a command palette, a **distributor switcher** dropdown (SuperAdmin only, default "همه شرکت‌های پخش"), theme toggle (sun/moon), notifications bell with a small red count badge.
- **Content area**: page background, max-width 1440px, 24px padding. Every page starts with a `PageHeader`: title, one-line description in secondary label, and right-aligned primary actions.
- Responsive: below 1024px the sidebar becomes a slide-in sheet from the right; tables switch to horizontal scroll.

**Sidebar navigation (Persian labels, lucide icons):**

1. داشبورد — `LayoutDashboard`
2. سفارش‌ها — `ClipboardList` (count badge for pending)
3. محصولات — `Package`
4. موجودی و قیمت — `Boxes`
5. شرکت‌های پخش — `Truck`
6. فروشگاه‌ها (خرده‌فروشان) — `Store`
7. بازاریابی — group: کدهای تخفیف `Ticket`, بنرها `Image`, پیام‌ها `Bell`
8. مالی — group: پرداخت‌ها `CreditCard`, کیف پول‌ها `Wallet`
9. ارسال — group: بازه‌های تحویل `Clock`, شهرها `MapPin`
10. تنظیمات — group: عمومی `Settings`, کارکنان `Users`, گزارش فعالیت `History`

## 3. Roles

Two roles; build a role switch on the login screen so both can be previewed.

- **مدیر پلتفرم (SuperAdmin)** — sees everything across all distributors. Distributor switcher visible in top bar.
- **مدیر شرکت پخش (DistributorAdmin)** — logged into one distributor (demo: `توزیع و پخش البرز`). Sidebar hides: شرکت‌های پخش, فروشگاه‌ها (global), بنرها, مالی, تنظیمات ▸ کارکنان/گزارش. All tables are pre-filtered to their distributor and the distributor column is hidden.

## 4. Screens

### 4.1 Auth

- `/login`: centered card on page background. Logo, title "ورود به پنل مدیریت", phone input (LTR digits, placeholder `۰۹۱۲۳۴۵۶۷۸۹`), primary button "ادامه", and two ghost buttons: "ورود آزمایشی مدیر پلتفرم" / "ورود آزمایشی مدیر شرکت پخش". Demo phone `09143662051`.
- `/otp`: 5 separate digit boxes, 5-digit code (demo `12345`), resend timer `۰۱:۵۹`, back link.

### 4.2 داشبورد `/`

- Row of 4 KPI cards: `فروش امروز` (۱۲٬۴۸۰٬۰۰۰ تومان, +۸٪ vs yesterday), `سفارش‌های در انتظار` (۱۴), `فروشگاه‌های فعال` (۳۲۸), `میانگین سبد` (۲٬۱۳۵٬۰۰۰ تومان). Each: label secondary, big Farsi number, small delta line (use ▲/▼ glyph in label secondary; no green/red).
- Two-column row: left 2/3 `روند سفارش‌ها (۳۰ روز)` area/line chart in gray ramp with Jalali x-axis labels; right 1/3 `وضعیت سفارش‌ها` donut (در انتظار / تایید شده / در حال بسته‌بندی / ارسال شده / تحویل شده / لغو شده) in gray ramp, cancelled slice red.
- Two-column row: `شرکت‌های پخش برتر` horizontal bar list (name, city, GMV); `هشدار کمبود موجودی` list with red dot, product name, distributor, remaining cartons.
- `آخرین سفارش‌ها` compact table (8 rows) with a "مشاهده همه" link.

### 4.3 سفارش‌ها `/orders` and `/orders/:id`

- Toolbar: search (شماره سفارش / نام فروشگاه), filter chips (وضعیت, شرکت پخش, شهر, بازه تاریخ جلالی), export CSV button, column visibility toggle.
- Status tabs above the table: همه · در انتظار · تایید شده · در حال بسته‌بندی · ارسال شده · تحویل شده · لغو شده (with counts).
- Table columns: شماره سفارش (`VT-482193`, monospace-ish), فروشگاه, شرکت پخش, شهر, اقلام (`۳ قلم · ۱۲ کارتن`), مبلغ, تاریخ تحویل, وضعیت (badge), actions `⋯`.
- Detail page: header with order number + status badge + primary action button that offers the **next valid transition only** (`تایید سفارش` → `شروع بسته‌بندی` → `ارسال شد` → `تحویل شد`), plus a destructive "لغو سفارش" in the `⋯` menu with a confirm dialog asking for a reason.
- Detail body: left column — items table (image thumbnail, name, `× ۲۴ عدد / کارتن`, qty cartons, unit price, line total), totals card (جمع, تخفیف, هزینه ارسال, قابل پرداخت). Right column — customer card (store name, phone, address with small static map placeholder), delivery card (distributor, Jalali slot `سه‌شنبه ۲۳ شهریور، ساعت ۱۰:۱۵`), payment card (روش: کیف پول / درگاه, وضعیت), and a vertical **timeline** of status events with timestamps and actor names.

### 4.4 محصولات `/products`, `/products/new`, `/products/:id`

- Table: تصویر, نام, برند, دسته / زیردسته, SKU, تعداد در کارتن, حداقل سفارش, قیمت پایه, تعداد پخش‌های عرضه‌کننده, وضعیت (فعال/غیرفعال switch).
- Filters: دسته (نوشیدنی, لبنیات, خواربار, بهداشتی, تنقلات, روغن و چربی, کنسرو), برند, وضعیت. Buttons: "افزودن محصول", "ورود از CSV".
- Form (two-column on desktop): image upload dropzone, نام, برند, دسته, زیردسته, SKU, اندازه (`۳۳۰ میلی‌لیتری`), تعداد در کارتن, حداقل تعداد سفارش, قیمت پایه, قیمت قبل (optional), درصد تخفیف (auto), توضیحات. Sticky footer with "ذخیره" / "انصراف".

### 4.5 موجودی و قیمت `/stock`

- A **matrix**: rows = products, columns = distributors (SuperAdmin) or a single-distributor list (DistributorAdmin). Each cell: availability switch + price shown as `پایه × ضریب` with an inline editable override. Distributor column header shows `ضریب قیمت` (e.g. `۱٫۰۵`) editable in a popover.
- Bulk bar appears when rows are selected: "فعال کردن", "غیرفعال کردن", "اعمال ضریب". Sticky first column (product) and header row.

### 4.6 شرکت‌های پخش `/distributors`, `/distributors/:id`

- Cards or table: name, area, cities served (chips), وضعیت (`فعال` / `ظرفیت پر`), زمان تحویل (`۴۵ دقیقه`), هزینه ارسال (`رایگان` / `۱۴٬۰۰۰ تومان`), ضریب قیمت, امتیاز (`۴٫۸`), badge `PRO`.
- Detail tabs: اطلاعات, شهرها و بازه‌ها, موجودی, سفارش‌ها, کارکنان.

### 4.7 فروشگاه‌ها `/retailers`, `/retailers/:id`

- Table: نام فروشگاه, شماره موبایل, شهر, تعداد سفارش, مجموع خرید, موجودی کیف پول, آخرین سفارش, وضعیت (فعال/مسدود).
- Detail: profile header with "مسدود کردن" destructive action; tabs آدرس‌ها (list + map placeholder), سفارش‌ها, کیف پول (balance + transactions).

### 4.8 بازاریابی

- `/marketing/coupons`: table of codes (`VISIT12`, `ALBORZ50`), نوع (درصدی/مبلغ ثابت), مقدار, حداقل سبد, محدود به شرکت پخش, انقضا (Jalali), استفاده‌شده/سقف, وضعیت switch. Sheet form for create/edit.
- `/marketing/banners`: sortable list of home banners with drag handle, title, subtitle, CTA, active switch, and a phone-frame preview on the right showing how the banner appears in the client app (red banner card `تخفیف تا ۴۰٪`).
- `/marketing/messages`: composer (title, body, نوع: سفارش/تبلیغاتی/موجودی, گیرندگان: همه / شهر / شرکت پخش) + sent history table.

### 4.9 مالی

- `/finance/payments`: ledger table — شناسه, نوع (سفارش / شارژ کیف پول), فروشگاه, مبلغ, روش, وضعیت (موفق / ناموفق), تاریخ.
- `/finance/wallets`: balances table + "تعدیل دستی" dialog (مبلغ, افزایش/کاهش, دلیل الزامی).

### 4.10 ارسال

- `/delivery/slots`: per-distributor weekly grid (شنبه…جمعه) of 30-minute slots from `۰۹:۴۵` to `۱۸:۴۵`, toggle cells on/off, holidays list, "کپی به همه روزها".
- `/delivery/cities`: table of cities (تبریز, تهران, کرج, اصفهان, مراغه, خوی, اسلامشهر, شهریار, نجف‌آباد) with count of distributors serving each.

### 4.11 تنظیمات

- `/settings/general`: حداقل مبلغ سفارش (`۵۰۰٬۰۰۰ تومان`), سقف/کف شارژ کیف پول (`۱۰٬۰۰۰` – `۱۰٬۰۰۰٬۰۰۰`), نام برند, لوگو.
- `/settings/staff`: staff table (نام, نقش, شرکت پخش, آخرین ورود, وضعیت) + invite sheet.
- `/settings/audit-log`: read-only table — زمان, کاربر, عملیات (`تغییر وضعیت سفارش VT-482193 به ارسال شده`), موجودیت.

### 4.12 Empty, loading, error states

Every table has a skeleton loading state and an empty state (line icon in label tertiary, one-line Persian message, optional action). Errors use red text only.

## 5. Sample data (use these names verbatim)

**Distributors**: شرکت پخش ایران (تبریز، مراغه · فعال · ۴۵ دقیقه · ۱۴٬۰۰۰ تومان · ×۱٫۰۰ · ۴٫۸), توزیع و پخش البرز (کرج، تهران · فعال · ۶۰ دقیقه · رایگان · ×۱٫۰۵ · ۴٫۵), شرکت توزیع آریا تجارت (تبریز · ظرفیت پر · ۹۰ دقیقه · رایگان · ×۰٫۹۷ · ۴٫۲), پخش پیشرو نوین (تهران، اسلامشهر، شهریار · ۳۰ دقیقه · ۸٬۰۰۰ · ×۱٫۰۸ · ۴٫۶), پخش آذربایجان (تبریز، خوی · ۴۰ دقیقه · رایگان · ×۱٫۰۲ · ۴٫۷), پخش سهند تبریز, پخش پایتخت, پخش نقش جهان (اصفهان، نجف‌آباد).

**Products** (name · brand · category · units/carton · price): نوشابه کوکاکولا ۳۳۰ میلی‌لیتری · کوکاکولا · نوشیدنی · ۲۴ · ۸۳٬۵۰۰ / نوشابه کوکاکولا ۱.۵ لیتری · ۱۲ · ۱۱۵٬۹۰۰ (was ۱۲۲٬۰۰۰, ۵٪) / نوشیدنی هلو پالپ‌دار رانی ۲۴۰ میلی‌لیتری · رانی · ۳۰ · ۸۵٬۵۰۰ / آب معدنی دماوند ۱.۵ لیتری · دماوند · ۱۲ · ۲۸٬۰۰۰ / شیر پاستوریزه میهن ۱ لیتری · میهن · لبنیات · ۱۲ · ۴۵٬۰۰۰ / ماست پاستوریزه کاله ۴۵۰ گرمی · کاله · ۱۲ · ۳۸٬۰۰۰ / پنیر پیتزای رامک ۴۵۰ گرمی · رامک · ۸ · ۸۵٬۰۰۰ / کره حیوانی صباح ۱۰۰ گرمی · صباح · ۲۴ · ۶۸٬۰۰۰ / چیپس خانواده ۱۷۰ گرمی · تنقلات · ۲۴ · ۴۲٬۰۰۰ / شکلات کیت‌کت ۴۱.۵ گرمی · ۳۶ · ۵۵٬۰۰۰ / آجیل مخلوط ممتاز ۵۰۰ گرمی · ۱۲ · ۱۸۵٬۰۰۰ / روغن نباتی اویلا ۱.۸ لیتر · اویلا · خواربار · ۶ · ۱٬۸۵۰٬۰۰۰ / مایع ظرفشویی گلرنگ ۱ لیتر · گلرنگ · بهداشتی · ۱۲ · ۸۸۰٬۰۰۰. SKUs like `CC-330`, `DW-1500`, `OL-180`.

**Retailers**: فروشگاه ملحمی (۰۹۱۴۳۶۶۲۰۵۱ · تبریز، نیروی هوایی، گجیل، پلاک ۲۴ · کیف پول ۱۸۵٬۰۰۰), سوپرمارکت آفتاب (تهران), هایپر شهروند (کرج), فروشگاه برادران رضایی (اصفهان), مینی‌مارکت نگین (تبریز).

**Orders**: `VT-482193` · فروشگاه ملحمی · توزیع و پخش البرز · ۲۸۲٬۷۰۰ تومان · تحویل ۲۳ شهریور ۱۴۰۵ · در انتظار; `VT-471002` · شرکت پخش ایران · ۱٬۸۵۰٬۰۰۰ · ۱۲ شهریور · تحویل شده; `VT-460881` · ۸۳٬۴۰۰ · ۸ شهریور · لغو شده; generate ~40 more in the same style.

**Coupons**: `VISIT12` — ۱۲٪ تخفیف خرید اول، حداقل ۵۰۰٬۰۰۰ تومان، تا ۳۱ شهریور; `ALBORZ50` — ۵۰٬۰۰۰ تومان اعتبار، فقط توزیع و پخش البرز، تا ۱۵ مهر.

**Staff**: امیر رضایی (مدیر پلتفرم), سارا محمدی (مدیر شرکت پخش — توزیع و پخش البرز), رضا کریمی (اپراتور سفارش‌ها — شرکت پخش ایران).

## 6. Interaction details

- Tables: row hover uses `fill`; sortable headers; sticky header; 20 rows per page with Farsi-digit pagination "۱–۲۰ از ۲۴۸".
- Filters live in the URL-like state so switching tabs keeps them. Active filter chips show an `×`.
- Forms: shadcn form fields, labels above inputs, inline validation in red, RTL text alignment, LTR for phone/SKU fields.
- Command palette (`⌘K`): jump to pages, search orders by number, retailers by name.
- Toasts appear top-center, monochrome, 3s.
- Confirm dialogs for every destructive action; the destructive button is red, everything else monochrome.
- Theme toggle persists; provide both themes for all screens.

## 7. Do not

- No colored status system (green/yellow/blue). Monochrome + red only.
- No gradients, glassmorphism, drop shadows on cards, or decorative illustrations.
- No left-side sidebar or LTR layouts. No Latin digits in UI numbers.
- No lorem ipsum; use the Persian sample data above.
