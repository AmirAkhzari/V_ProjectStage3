import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import FormField from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveDistributor } from "@/features/catalog";
import { useCities } from "@/features/ops";
import { toAsciiDigits } from "@/lib/format";
import { isValidIranMobile } from "@/lib/phone";
import { MIN_ORDER } from "@/types";
import type { Distributor } from "@/types";

const num = (msg: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(toAsciiDigits(v).replace(/[^\d.]/g, "")) : v),
    z.number({ error: msg }),
  );

const schema = z.object({
  name: z.string().trim().min(3, "نام شرکت حداقل ۳ کاراکتر"),
  logoText: z.string().trim().min(1, "متن لوگو را وارد کنید").max(14, "حداکثر ۱۴ کاراکتر"),
  managerName: z.string().trim().min(2, "نام مدیر را وارد کنید"),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || /^0\d{10}$/.test(toAsciiDigits(v)) || isValidIranMobile(v), "شماره معتبر نیست"),
  cities: z.array(z.string()).min(1, "حداقل یک شهر انتخاب کنید"),
  area: z.string().trim().optional(),
  status: z.enum(["active", "full"]),
  deliveryMins: num("عدد معتبر").pipe(z.number().int().min(10).max(600)),
  freeDelivery: z.boolean(),
  deliveryFee: num("عدد معتبر").pipe(z.number().min(0)),
  priceMultiplier: num("عدد معتبر").pipe(z.number().min(0.5, "حداقل ۰٫۵").max(2, "حداکثر ۲")),
  minBasket: num("عدد معتبر").pipe(z.number().min(0)),
  pro: z.boolean(),
});

type FormValues = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

export default function DistributorFormDialog({
  open,
  onOpenChange,
  distributor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  distributor?: Distributor;
}) {
  const save = useSaveDistributor();
  const { data: cities } = useCities();
  const form = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      logoText: "",
      managerName: "",
      phone: "",
      cities: [],
      area: "",
      status: "active",
      deliveryMins: 45,
      freeDelivery: false,
      deliveryFee: 10_000,
      priceMultiplier: 1,
      minBasket: MIN_ORDER,
      pro: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (distributor) {
      form.reset({
        name: distributor.name,
        logoText: distributor.logoText,
        managerName: distributor.managerName ?? "",
        phone: distributor.phone ?? "",
        cities: distributor.cities,
        area: distributor.area ?? "",
        status: distributor.status,
        deliveryMins: distributor.deliveryMins,
        freeDelivery: distributor.deliveryFee === "free",
        deliveryFee: distributor.deliveryFee === "free" ? 0 : distributor.deliveryFee,
        priceMultiplier: distributor.priceMultiplier,
        minBasket: distributor.minBasket,
        pro: Boolean(distributor.pro),
      });
    } else form.reset();
  }, [open, distributor, form]);

  const errors = form.formState.errors;
  const selected = form.watch("cities");
  const freeDelivery = form.watch("freeDelivery");

  const onSubmit = async (v: Parsed) => {
    await save.mutateAsync({
      id: distributor?.id,
      name: v.name,
      logoText: v.logoText,
      logoTone: distributor?.logoTone ?? "accent",
      status: v.status,
      deliveryMins: v.deliveryMins,
      deliveryFee: v.freeDelivery ? "free" : v.deliveryFee,
      priceMultiplier: v.priceMultiplier,
      cities: v.cities,
      rating: distributor?.rating ?? 4.5,
      area: v.area || undefined,
      pro: v.pro,
      minBasket: v.minBasket,
      phone: v.phone || undefined,
      managerName: v.managerName,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{distributor ? "ویرایش شرکت پخش" : "شرکت پخش جدید"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="نام شرکت" htmlFor="d-name" error={errors.name?.message}>
              <Input id="d-name" {...form.register("name")} />
            </FormField>
            <FormField
              label="متن لوگو"
              htmlFor="d-logo"
              error={errors.logoText?.message}
              hint="حداکثر دو خط، با Enter جدا کنید"
            >
              <Input id="d-logo" {...form.register("logoText")} />
            </FormField>
            <FormField label="نام مدیر" htmlFor="d-manager" error={errors.managerName?.message}>
              <Input id="d-manager" {...form.register("managerName")} />
            </FormField>
            <FormField label="تلفن" htmlFor="d-phone" error={errors.phone?.message}>
              <Input id="d-phone" dir="ltr" {...form.register("phone")} />
            </FormField>
            <FormField label="محدوده" htmlFor="d-area" hint="اختیاری">
              <Input id="d-area" {...form.register("area")} />
            </FormField>
            <FormField label="وضعیت" error={errors.status?.message}>
              <Select
                value={form.watch("status")}
                onValueChange={(v) => form.setValue("status", v as "active" | "full")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">فعال</SelectItem>
                  <SelectItem value="full">ظرفیت پر</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField label="شهرهای تحت پوشش" error={errors.cities?.message}>
            <div className="flex flex-wrap gap-2 rounded-xl bg-input p-3">
              {cities?.map((c) => {
                const checked = selected.includes(c.name);
                return (
                  <label
                    key={c.name}
                    className="flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-[12px]"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        form.setValue("cities", v ? [...selected, c.name] : selected.filter((x) => x !== c.name), {
                          shouldValidate: true,
                        })
                      }
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="زمان تحویل (دقیقه)" htmlFor="d-mins" error={errors.deliveryMins?.message}>
              <Input id="d-mins" inputMode="numeric" {...form.register("deliveryMins")} />
            </FormField>
            <FormField label="ضریب قیمت" htmlFor="d-mult" error={errors.priceMultiplier?.message}>
              <Input id="d-mult" dir="ltr" {...form.register("priceMultiplier")} />
            </FormField>
            <FormField label="حداقل سبد (تومان)" htmlFor="d-min" error={errors.minBasket?.message}>
              <Input id="d-min" inputMode="numeric" {...form.register("minBasket")} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl bg-input px-3.5 py-2.5">
              <Label>ارسال رایگان</Label>
              <Switch checked={freeDelivery} onCheckedChange={(v) => form.setValue("freeDelivery", v)} />
            </div>
            <FormField label="هزینه ارسال (تومان)" htmlFor="d-fee" error={errors.deliveryFee?.message}>
              <Input id="d-fee" inputMode="numeric" disabled={freeDelivery} {...form.register("deliveryFee")} />
            </FormField>
            <div className="flex items-center justify-between rounded-xl bg-input px-3.5 py-2.5">
              <Label>نشان PRO</Label>
              <Switch checked={form.watch("pro")} onCheckedChange={(v) => form.setValue("pro", v)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {distributor ? "ذخیره" : "ایجاد"}
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
