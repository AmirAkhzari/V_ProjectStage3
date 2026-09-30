import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BackHeader from "@/components/layout/BackHeader";
import BrandedWaitScreen from "@/components/ui/BrandedWaitScreen";
import Button from "@/components/ui/Button";
import { toFaNum } from "@/lib/format";
import { WALLET_MAX, WALLET_MIN } from "@/types";
import { api } from "@/services/client";
import { useAppStore } from "@/store/useAppStore";

export default function WalletPage() {
  const navigate = useNavigate();
  const balance = useAppStore((s) => s.walletBalance);
  const [amount, setAmount] = useState(50_000);
  const [busy, setBusy] = useState(false);
  const valid = amount >= WALLET_MIN && amount <= WALLET_MAX;

  const pay = async () => {
    setBusy(true);
    try {
      const payment = await api.createPayment("wallet", amount);
      navigate(`/pay/${payment.id}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto bg-page">
      {busy && <BrandedWaitScreen overlay />}
      <BackHeader title="افزایش اعتبار کیف پول" />
      <div className="p-5">
        <div className="bg-accent text-inverse rounded-[22px] p-5 mb-4">
          <div className="text-xs text-inverse/70">موجودی فعلی</div>
          <div className="text-[25px] font-black mt-1">{toFaNum(balance)} <span className="text-sm font-medium">تومان</span></div>
          <div className="text-[11px] text-inverse/70 mt-3">نمایشی · بدون اتصال به بانک</div>
        </div>
        <div className="font-bold mb-3">مبلغ افزایش اعتبار</div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[50_000, 150_000, 300_000].map((p) => (
            <button key={p} type="button" onClick={() => setAmount(p)} className={`h-12 rounded-xl border text-xs font-bold ${amount === p ? "border-accent bg-brand-tint text-accent" : "border-border bg-card text-secondary"}`}>{toFaNum(p)}</button>
          ))}
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 mb-4">
          <div className="text-xs text-text-secondary mb-2">مبلغ دلخواه</div>
          <div className="flex items-center gap-2" dir="ltr">
            <button type="button" onClick={() => setAmount((a) => Math.max(WALLET_MIN, a - 10_000))} className="size-10 rounded-xl border border-border bg-card">−</button>
            <input className="flex-1 h-11 rounded-[10px] border border-border bg-card text-center font-extrabold" value={toFaNum(amount)} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)} />
            <button type="button" onClick={() => setAmount((a) => Math.min(WALLET_MAX, a + 10_000))} className="size-10 rounded-xl border border-border bg-card">+</button>
          </div>
        </div>
        <Button disabled={!valid} loading={busy} onClick={pay}>پرداخت از درگاه نمایشی</Button>
      </div>
    </div>
  );
}
