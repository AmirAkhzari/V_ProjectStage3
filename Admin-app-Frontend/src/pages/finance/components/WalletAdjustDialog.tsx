import { useEffect, useState } from "react";
import FormField from "@/components/shared/FormField";
import Price from "@/components/shared/Price";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdjustWallet } from "@/features/ops";
import { toAsciiDigits, toFaNum } from "@/lib/format";
import type { WalletAccount } from "@/types";

export default function WalletAdjustDialog({
  open,
  onOpenChange,
  wallet,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: WalletAccount;
}) {
  const adjust = useAdjustWallet();
  const [dir, setDir] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setDir("credit");
      setAmount("");
      setNote("");
    }
  }, [open]);

  const n = Number(toAsciiDigits(amount).replace(/[^\d]/g, "")) || 0;
  const signed = dir === "credit" ? n : -n;
  const next = wallet.balance + signed;
  const error =
    n <= 0 ? "" : n > 50_000_000 ? "حداکثر ۵۰ میلیون تومان در هر تعدیل" : next < 0 ? "موجودی نمی‌تواند منفی شود" : "";
  const valid = n > 0 && !error && note.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعدیل کیف پول</DialogTitle>
          <DialogDescription>
            {wallet.retailerName} · موجودی فعلی{" "}
            <Price value={wallet.balance} className="font-semibold text-foreground" />
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Tabs value={dir} onValueChange={(v) => setDir(v as "credit" | "debit")}>
            <TabsList className="w-full">
              <TabsTrigger value="credit" className="flex-1">
                افزایش اعتبار
              </TabsTrigger>
              <TabsTrigger value="debit" className="flex-1">
                کسر اعتبار
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <FormField label="مبلغ (تومان)" htmlFor="w-amount" error={error}>
            <Input
              id="w-amount"
              inputMode="numeric"
              value={n ? toFaNum(n) : ""}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="۰"
              className="text-[16px] font-semibold"
            />
          </FormField>
          <div className="flex flex-wrap gap-1.5">
            {[50_000, 100_000, 500_000, 1_000_000].map((v) => (
              <Button key={v} type="button" variant="secondary" size="sm" onClick={() => setAmount(String(v))}>
                {toFaNum(v)}
              </Button>
            ))}
          </div>
          <FormField label="دلیل (در گزارش فعالیت ثبت می‌شود)" htmlFor="w-note" hint="حداقل ۳ کاراکتر">
            <Textarea id="w-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20" />
          </FormField>
          <div className="flex items-center justify-between rounded-xl bg-fill px-3.5 py-2.5 text-[13px]">
            <span className="text-label-secondary">موجودی پس از تعدیل</span>
            <Price value={Math.max(0, next)} className="font-semibold" />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant={dir === "debit" ? "destructive" : "primary"}
            disabled={!valid}
            loading={adjust.isPending}
            onClick={async () => {
              const res = await adjust.mutateAsync({
                retailerId: wallet.retailerId,
                amount: signed,
                note: note.trim(),
              });
              if (res.ok) onOpenChange(false);
            }}
          >
            {dir === "credit" ? "افزایش اعتبار" : "کسر اعتبار"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
