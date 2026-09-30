import BackHeader from "@/components/layout/BackHeader";
import SubscriptionPurchase from "@/components/plan/SubscriptionPurchase";

export default function SubscriptionPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page" dir="rtl">
      <BackHeader title="اشتراک حرفه‌ای" />
      <div className="p-5">
        <div className="mb-5 text-right">
          <h1 className="text-[28px] font-bold leading-10">بازار شرکت‌های پخش شهر شما</h1>
          <p className="text-[14px] text-text-secondary leading-7 mt-2">
            با اشتراک حرفه‌ای ماهانه می‌توانید همه شرکت‌های پخش پوشش‌دهنده شهرتان را ببینید، قیمت‌ها را مقایسه کنید، شرکت را عوض کنید و از هر کدام سفارش بدهید. شرکت پخش اصلی بدون این اشتراک هم در دسترس می‌ماند.
          </p>
        </div>
        <SubscriptionPurchase />
        <div className="bg-card rounded-[18px] p-5 mt-3 text-right">
          <div className="font-semibold text-[17px] mb-3">نکات کوتاه</div>
          <ul className="space-y-2.5 text-[13px] text-text-secondary leading-7">
            <li>دوره اشتراک ماهانه است و از قیمت پیکربندی‌شده سرور محاسبه می‌شود.</li>
            <li>طرح حرفه‌ای فروشگاه با نشان حرفه‌ای روی شرکت پخش یکی نیست.</li>
            <li>پرداخت از درگاه نمایشی است و به بانک وصل نیست.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
