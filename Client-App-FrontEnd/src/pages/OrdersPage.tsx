import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Button from "@/components/ui/Button";
import BackHeader from "@/components/layout/BackHeader";
import { toFaNum } from "@/lib/format";
import { api } from "@/services/client";
import type { Order, OrderStatus } from "@/types";
import { useAppStore } from "@/store/useAppStore";
import EmptyState from "@/components/ui/EmptyState";
import { IlluOrders, IlluSuccess } from "@/components/illustrations";
import StatusBadge from "@/components/ui/StatusBadge";
import ProductImage from "@/components/ui/ProductImage";
import Spinner from "@/components/ui/Spinner";

export default function OrdersPage() {
  const navigate = useNavigate();
  const orders = useAppStore((s) => s.orders);
  const refresh = useAppStore((s) => s.refreshOrders);
  const [tab, setTab] = useState<OrderStatus>("current");
  useEffect(() => { void refresh(); }, [refresh]);
  const filtered = orders.filter((o) => o.status === tab);
  const tabs: { key: OrderStatus; label: string }[] = [
    { key: "current", label: "جاری" },
    { key: "delivered", label: "تحویل شده" },
    { key: "cancelled", label: "لغو شده" },
  ];
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-page">
      <div className="bg-card">
        <BackHeader title="سفارش‌ها" onBack={() => navigate("/")} />
        <div className="px-5 pb-3 flex gap-2 justify-end">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`px-4 py-1.5 rounded-full border text-[13px] font-semibold ${tab === t.key ? "bg-accent text-inverse border-accent" : "border-border text-secondary bg-card"}`}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {filtered.length === 0 && (
          <EmptyState
            icon={<IlluOrders />}
            title="هنوز سفارشی ثبت نکردی!"
            body={tab === "current" ? "سفارش فعالی وجود ندارد" : tab === "delivered" ? "هنوز سفارشی تحویل نگرفته‌اید" : "هیچ سفارشی لغو نشده"}
          />
        )}
        {filtered.map((o) => (
          <button key={o.id} type="button" onClick={() => navigate(`/orders/${o.id}`)} className="w-full bg-card rounded-2xl border border-border p-4 mb-3 text-right">
            <div className="flex justify-between items-start mb-2">
              <StatusBadge status={o.status} />
              <span className="font-extrabold">{o.number}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-accent font-black">{toFaNum(o.total)} تومان</span>
              <span className="text-text-secondary">{o.deliveryDate} · {toFaNum(o.items.length)} قلم</span>
            </div>
            <div className="text-[12px] text-text-secondary mt-1 truncate">{o.distributorName}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    if (id) void api.getOrder(id).then(setOrder);
  }, [id]);
  if (!order) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-secondary">
        <Spinner className="text-accent" />
        در حال بارگذاری سفارش...
      </div>
    );
  }
  const confirmed = params.get("confirmed") === "1";
  const steps = order.status === "cancelled"
    ? ["ثبت شد", "لغو شد"]
    : ["ثبت شد", "آماده‌سازی", "ارسال", "تحویل"];
  const active = order.status === "delivered" ? 3 : order.status === "cancelled" ? 1 : 1;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-page">
      <BackHeader title={confirmed ? "سفارش ثبت شد" : "جزئیات سفارش"} />
      <div className="p-4">
        {confirmed && (
          <div className="text-center mb-4">
            <IlluSuccess />
            <div className="text-[22px] font-black mt-2">سفارش شما ثبت شد!</div>
            <p className="text-[13px] text-text-secondary">سفارش نمایشی است؛ پیامک واقعی ارسال نمی‌شود</p>
          </div>
        )}
        <div className="bg-card rounded-[20px] border border-border p-4 mb-3 flex justify-between gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex-1 text-center">
              <div className={`mx-auto mb-1 size-2.5 rounded-full ${i <= active ? "bg-accent" : "bg-border"}`} />
              <div className={`text-[11px] ${i <= active ? "font-bold text-accent" : "text-secondary"}`}>{s}</div>
            </div>
          ))}
        </div>
        <div className="bg-card rounded-[20px] border border-border p-5 flex flex-col gap-3">
          <Row k="شماره سفارش" v={order.number} />
          <Row k="وضعیت" v={order.status === "current" ? "جاری" : order.status === "delivered" ? "تحویل شده" : "لغو شده"} />
          <Row k="جمع کل" v={`${toFaNum(order.total)} تومان`} />
          <Row k="تاریخ تحویل" v={order.deliveryDate} />
          <Row k="آدرس" v={order.addressLabel} />
        </div>
        <div className="bg-card rounded-[20px] border border-border p-4 mt-3">
          {order.items.map((i) => (
            <div key={i.id} className="flex items-center gap-3 py-2">
              <ProductImage src={i.img} alt={i.name} className="size-12 rounded-xl" />
              <div className="flex-1 min-w-0 text-[13px] font-semibold line-clamp-1">{i.name} × {toFaNum(i.qty)}</div>
              <span className="text-[13px] font-bold">{toFaNum(i.price * i.qty)}</span>
            </div>
          ))}
        </div>
        <Button className="mt-4" onClick={() => navigate("/")}>بازگشت به صفحه اصلی</Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="font-bold text-accent text-left">{v}</span>
      <span className="text-text-secondary shrink-0">{k}</span>
    </div>
  );
}
