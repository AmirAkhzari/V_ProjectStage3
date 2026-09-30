import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import FormField from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSaveCoupon } from "@/features/marketing";
import { useAllDistributors } from "@/features/catalog";
import { useIsDistributorAdmin } from "@/store/useSessionStore";
import { toAsciiDigits } from "@/lib/format";
import { daysAhead, formatJalali, toGregorian, toJalali } from "@/lib/jalali";
import type { Coupon } from "@/types";

const num = z.preprocess(
  (v) =>
    typeof v === "string" && v.trim() !== ""
      ? Number(toAsciiDigits(v).replace(/[^\d]/g, ""))
      : v === ""
        ? undefined
        : v,
  z.number().nonnegative().optional(),
);

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "کد حداقل ۳ کاراکتر")
      .regex(/^[A-Za-z0-9_-]+$/, "فقط حروف و اعداد انگلیسی"),
    title: z.string().trim().min(3, "عنوان را وارد کنید"),
    kind: z.enum(["percent", "fixed"]),
    value: num.pipe(z.number({ error: "مقدار را وارد کنید" }).positive("مقدار باید مثبت باشد")),
    minTotal: num,
    maxUses: num,
    distributorId: z.string(),
    expiresInDays: num.pipe(z.number({ error: "مدت را وارد کنید" }).int().min(1, "حداقل ۱ روز")),
    active: z.boolean(),
  })
  .refine((v) => v.kind !== "percent" || v.value <= 90, {
    message: "درصد تخفیف حداکثر ۹۰",
    path: ["value"],
  });

type FormValues = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

function daysUntil(iso: string) {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export default function CouponFormDialog({
  open,
  onOpenChange,
  coupon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coupon?: Coupon;
}) {
  const save = useSaveCoupon();
  const isDistributor = useIsDistributorAdmin();
  const { data: distributors } = useAllDistributors();
  const form = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      title: "",
      kind: "percent",
      value: 10,
      minTotal: undefined,
      maxUses: undefined,
      distributorId: "all",
      expiresInDays: 30,
      active: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (coupon)
      form.reset({
        ...coupon,
        distributorId: coupon.distributorId ?? "all",
        expiresInDays: daysUntil(coupon.expiresAt),
        minTotal: coupon.minTotal,
        maxUses: coupon.maxUses,
      });
    else form.reset();
  }, [open, coupon, form]);

  const errors = form.formState.errors;
  const kind = form.watch("kind");
  const days = Number(toAsciiDigits(String(form.watch("expiresInDays") ?? "")) || 0);
  const expiresPreview = days > 0 ? formatJalali(toGregorian(toJalali(daysAhead(days)))) : null;

  const onSubmit = async (v: Parsed) => {
    await save.mutateAsync({
      id: coupon?.id,
      code: v.code,
      title: v.title,
      kind: v.kind,
      value: v.value,
      minTotal: v.minTotal || undefined,
      maxUses: v.maxUses || undefined,
      distributorId: v.distributorId === "all" ? undefined : v.distributorId,
      expiresAt: daysAhead(v.expiresInDays).toISOString(),
      active: v.active,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{coupon ? "ویرایش کد تخفیف" : "کد تخفیف جدید"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="کد" htmlFor="c-code" error={errors.code?.message}>
              <Input id="c-code" dir="ltr" className="uppercase" {...form.register("code")} />
            </FormField>
            <FormField label="عنوان" htmlFor="c-title" error={errors.title?.message}>
              <Input id="c-title" {...form.register("title")} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="نوع تخفیف">
              <Tabs value={kind} onValueChange={(v) => form.setValue("kind", v as "percent" | "fixed")}>
                <TabsList className="w-full">
                  <TabsTrigger value="percent" className="flex-1">
                    درصدی
                  </TabsTrigger>
                  <TabsTrigger value="fixed" className="flex-1">
                    مبلغی
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </FormField>
            <FormField
              label={kind === "percent" ? "درصد تخفیف" : "مبلغ تخفیف (تومان)"}
              htmlFor="c-value"
              error={errors.value?.message}
            >
              <Input id="c-value" inputMode="numeric" {...form.register("value")} />
            </FormField>
            <FormField label="حداقل سبد (تومان)" htmlFor="c-min" error={errors.minTotal?.message} hint="اختیاری">
              <Input id="c-min" inputMode="numeric" {...form.register("minTotal")} />
            </FormField>
            <FormField label="سقف استفاده" htmlFor="c-max" error={errors.maxUses?.message} hint="خالی = نامحدود">
              <Input id="c-max" inputMode="numeric" {...form.register("maxUses")} />
            </FormField>
            <FormField
              label="اعتبار (روز)"
              htmlFor="c-days"
              error={errors.expiresInDays?.message}
              hint={expiresPreview ? `تا ${expiresPreview}` : undefined}
            >
              <Input id="c-days" inputMode="numeric" {...form.register("expiresInDays")} />
            </FormField>
            {!isDistributor ? (
              <FormField label="محدوده">
                <Select value={form.watch("distributorId")} onValueChange={(v) => form.setValue("distributorId", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه شرکت‌های پخش</SelectItem>
                    {distributors?.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
          </div>
          <div className="flex items-center justify-between rounded-xl bg-input px-3.5 py-2.5">
            <Label>فعال</Label>
            <Switch checked={form.watch("active")} onCheckedChange={(v) => form.setValue("active", v)} />
          </div>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {coupon ? "ذخیره" : "ایجاد"}
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
