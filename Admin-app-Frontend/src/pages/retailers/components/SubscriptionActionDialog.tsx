import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import FormField from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSetRetailerSubscription } from "@/features/people";
import { toAsciiDigits } from "@/lib/format";
import type { Retailer, SubscriptionAction } from "@/types";

const schema = z.object({
  days: z.preprocess(
    (v) => (typeof v === "string" ? Number(toAsciiDigits(v).replace(/[^\d]/g, "")) : v),
    z.number({ error: "تعداد روز معتبر نیست" }).int().min(1, "حداقل ۱ روز").max(365, "حداکثر ۳۶۵ روز"),
  ),
});

type Values = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

export default function SubscriptionActionDialog({
  open,
  onOpenChange,
  retailer,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  retailer: Retailer;
  action: Extract<SubscriptionAction, "grant" | "extend">;
}) {
  const save = useSetRetailerSubscription();
  const form = useForm<Values, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: { days: 30 },
  });

  useEffect(() => {
    if (open) form.reset({ days: 30 });
  }, [open, form]);

  const grant = action === "grant";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{grant ? "اعطای اشتراک پرو" : "تمدید اشتراک پرو"}</DialogTitle>
          <DialogDescription>
            {grant
              ? `${retailer.name} به بازار شهر دسترسی پیدا می‌کند و می‌تواند از همه شرکت‌های پخش همان شهر خرید کند.`
              : `مدت اشتراک پرو «${retailer.name}» از تاریخ انقضای فعلی تمدید می‌شود.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            const res = await save.mutateAsync({ id: retailer.id, action, days: v.days });
            if (res.ok) onOpenChange(false);
          })}
        >
          <FormField label="مدت (روز)" htmlFor="sub-days" error={form.formState.errors.days?.message} hint="پیش‌فرض ۳۰ روز">
            <Input id="sub-days" inputMode="numeric" {...form.register("days")} />
          </FormField>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {grant ? "اعطا کن" : "تمدید کن"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
