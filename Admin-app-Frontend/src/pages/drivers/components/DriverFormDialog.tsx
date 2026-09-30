import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveDriver } from "@/features/drivers";
import { useAllDistributors } from "@/features/catalog";
import { useActiveDistributorId } from "@/store/useSessionStore";
import { isValidIranMobile } from "@/lib/phone";
import type { Driver } from "@/types";

const schema = z
  .object({
    name: z.string().trim().min(3, "نام کامل را وارد کنید"),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9._-]{2,31}$/, "فقط حروف کوچک انگلیسی، عدد، نقطه یا خط تیره (۳ تا ۳۲ کاراکتر)"),
    phone: z.string().trim().refine(isValidIranMobile, "شماره موبایل معتبر نیست"),
    vehicleType: z.string().trim().max(40),
    vehiclePlate: z.string().trim().max(24),
    distributorId: z.string().min(1, "شرکت پخش را انتخاب کنید"),
    password: z.string(),
    active: z.boolean(),
    isNew: z.boolean(),
  })
  .refine((v) => !v.isNew || v.password.length >= 6, { message: "رمز عبور حداقل ۶ کاراکتر", path: ["password"] });
type Values = z.infer<typeof schema>;

export function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export default function DriverFormDialog({
  open,
  onOpenChange,
  driver,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  driver?: Driver;
}) {
  const save = useSaveDriver();
  const scope = useActiveDistributorId();
  const { data: distributors } = useAllDistributors();
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    form.reset({
      name: driver?.name ?? "",
      username: driver?.username ?? "",
      phone: driver?.phone ?? "",
      vehicleType: driver?.vehicle?.type ?? "",
      vehiclePlate: driver?.vehicle?.plate ?? "",
      distributorId: driver?.distributorId ?? scope ?? "",
      password: driver ? "" : generatePassword(),
      active: driver?.active ?? true,
      isNew: !driver,
    });
  }, [open, driver, scope, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {created ? (
          <CredentialsView credentials={created} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{driver ? "ویرایش راننده" : "راننده جدید"}</DialogTitle>
              <DialogDescription>
                راننده با شناسه و رمز عبور وارد اپلیکیشن راننده می‌شود و فقط سفارش‌هایی را می‌بیند که به او سپرده شده.
              </DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit(async (v) => {
                const res = await save.mutateAsync({
                  id: driver?.id,
                  distributorId: v.distributorId,
                  name: v.name,
                  username: v.username,
                  phone: v.phone,
                  vehicle: v.vehicleType ? { type: v.vehicleType, plate: v.vehiclePlate } : null,
                  active: v.active,
                  password: driver ? undefined : v.password,
                });
                if (!res.ok) return;
                if (driver) onOpenChange(false);
                else setCreated({ username: res.data.username, password: v.password });
              })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="نام و نام خانوادگی" htmlFor="dr-name" error={errors.name?.message}>
                  <Input id="dr-name" {...form.register("name")} />
                </FormField>
                <FormField label="موبایل" htmlFor="dr-phone" error={errors.phone?.message}>
                  <Input id="dr-phone" dir="ltr" inputMode="tel" {...form.register("phone")} />
                </FormField>
              </div>
              <FormField
                label="شناسه راننده (نام کاربری)"
                htmlFor="dr-username"
                error={errors.username?.message}
                hint="در کل پلتفرم یکتا است؛ مثلاً ali.rezaei"
              >
                <Input id="dr-username" dir="ltr" autoCapitalize="none" {...form.register("username")} />
              </FormField>
              {!scope ? (
                <FormField label="شرکت پخش" error={errors.distributorId?.message}>
                  <Select
                    value={form.watch("distributorId") ?? ""}
                    disabled={Boolean(driver)}
                    onValueChange={(v) => form.setValue("distributorId", v, { shouldValidate: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="انتخاب شرکت پخش" />
                    </SelectTrigger>
                    <SelectContent>
                      {distributors?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="خودرو (اختیاری)" htmlFor="dr-vehicle" error={errors.vehicleType?.message}>
                  <Input id="dr-vehicle" placeholder="مثلاً نیسان یخچال‌دار" {...form.register("vehicleType")} />
                </FormField>
                <FormField label="پلاک (اختیاری)" htmlFor="dr-plate" error={errors.vehiclePlate?.message}>
                  <Input id="dr-plate" placeholder="۲۲ ب ۳۶۵ ایران ۶۸" {...form.register("vehiclePlate")} />
                </FormField>
              </div>
              {!driver ? (
                <FormField
                  label="رمز عبور اولیه"
                  htmlFor="dr-pass"
                  error={errors.password?.message}
                  hint="پس از ذخیره فقط یک بار نمایش داده می‌شود"
                >
                  <div className="flex gap-2">
                    <Input id="dr-pass" dir="ltr" className="font-mono" {...form.register("password")} />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      aria-label="ساخت رمز تصادفی"
                      onClick={() => form.setValue("password", generatePassword(), { shouldValidate: true })}
                    >
                      <RefreshCw />
                    </Button>
                  </div>
                </FormField>
              ) : null}
              <div className="flex items-center justify-between rounded-xl bg-input px-3.5 py-2.5">
                <div>
                  <Label>حساب فعال</Label>
                  <p className="text-[12px] text-label-tertiary">راننده غیرفعال نمی‌تواند وارد شود یا سفارش بگیرد</p>
                </div>
                <Switch checked={form.watch("active")} onCheckedChange={(v) => form.setValue("active", v)} />
              </div>
              <DialogFooter>
                <Button type="submit" loading={save.isPending}>
                  {driver ? "ذخیره" : "ساخت راننده"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  انصراف
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CredentialsView({
  credentials,
  onClose,
  title = "راننده ساخته شد",
}: {
  credentials: { username: string; password: string };
  onClose: () => void;
  title?: string;
}) {
  const text = `شناسه: ${credentials.username}\nرمز عبور: ${credentials.password}`;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> {title}
        </DialogTitle>
        <DialogDescription>
          این اطلاعات را به راننده بدهید. رمز عبور دوباره نمایش داده نمی‌شود؛ در صورت فراموشی آن را بازنشانی کنید.
        </DialogDescription>
      </DialogHeader>
      <dl className="grid gap-2 rounded-xl bg-fill p-4 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-label-secondary">شناسه راننده</dt>
          <dd className="ltr font-mono font-semibold">{credentials.username}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-label-secondary">رمز عبور</dt>
          <dd className="ltr font-mono font-semibold">{credentials.password}</dd>
        </div>
      </dl>
      <DialogFooter>
        <Button onClick={onClose}>متوجه شدم</Button>
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard?.writeText(text).catch(() => undefined);
            toast.success("اطلاعات ورود کپی شد");
          }}
        >
          <Copy /> کپی
        </Button>
      </DialogFooter>
    </>
  );
}
