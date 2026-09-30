import { useState } from "react";
import { Check, X } from "lucide-react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import Can from "@/components/shared/Can";
import { Button } from "@/components/ui/button";
import { useConfirmDelivery, useRejectDelivery } from "@/features/drivers";
import { formatTime } from "@/lib/jalali";

type Target = {
  id: string;
  orderNumber: string;
  retailerName: string;
  driverName: string;
  submittedAt: string | null;
};

/** [تایید تحویل] / [رد] for a delivery whose code the backend already validated. */
export default function DeliveryDecision({
  delivery,
  size = "md",
  onDone,
}: {
  delivery: Target;
  size?: "sm" | "md";
  onDone?: () => void;
}) {
  const [dialog, setDialog] = useState<null | "confirm" | "reject">(null);
  const confirm = useConfirmDelivery();
  const reject = useRejectDelivery();

  return (
    <Can perm="deliveries.confirm">
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size={size} onClick={() => setDialog("confirm")} loading={confirm.isPending}>
          <Check /> تایید تحویل
        </Button>
        <Button size={size} variant="outline" onClick={() => setDialog("reject")}>
          <X /> رد
        </Button>
      </div>
      <ConfirmDialog
        open={dialog === "confirm"}
        onOpenChange={(v) => !v && setDialog(null)}
        title="تایید تحویل"
        description={
          <>
            راننده <b className="text-foreground">{delivery.driverName}</b> کد تحویل سفارش{" "}
            <span className="ltr inline-block font-semibold text-foreground">{delivery.orderNumber}</span> (
            {delivery.retailerName}) را
            {delivery.submittedAt ? ` ساعت ${formatTime(delivery.submittedAt)}` : ""} ثبت کرده و سرور آن را تایید کرده
            است. با تایید شما وضعیت سفارش «تحویل شده» می‌شود.
          </>
        }
        confirmLabel="تایید تحویل"
        loading={confirm.isPending}
        onConfirm={async () => {
          const res = await confirm.mutateAsync(delivery.id);
          setDialog(null);
          if (res.ok) onDone?.();
        }}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        onOpenChange={(v) => !v && setDialog(null)}
        title="رد تایید تحویل"
        description="سفارش تحویل‌شده ثبت نمی‌شود و به راننده اطلاع داده می‌شود. پس از رد، می‌توانید سفارش را دوباره به همین یا راننده دیگری بسپارید."
        confirmLabel="رد تحویل"
        destructive
        requireReason
        reasonLabel="دلیل رد (برای راننده نمایش داده می‌شود)"
        loading={reject.isPending}
        onConfirm={async (reason) => {
          const res = await reject.mutateAsync({ deliveryId: delivery.id, reason: reason ?? "" });
          setDialog(null);
          if (res.ok) onDone?.();
        }}
      />
    </Can>
  );
}
