import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Database, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/shared/PageHeader";
import FormField from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSaveSettings, useSettings } from "@/features/ops";
import { useUiStore } from "@/store/useUiStore";
import { api } from "@/services/client";
import { toAsciiDigits } from "@/lib/format";
import SettingsTabs from "./components/SettingsTabs";

const num = (msg: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(toAsciiDigits(v).replace(/[^\d]/g, "")) : v),
    z.number({ error: msg }).nonnegative(msg),
  );

const schema = z
  .object({
    brandName: z.string().trim().min(2, "نام برند را وارد کنید"),
    supportPhone: z.string().trim().min(8, "شماره پشتیبانی معتبر نیست"),
    minOrder: num("مبلغ معتبر").pipe(z.number().min(10_000, "حداقل ۱۰٬۰۰۰ تومان")),
    walletMin: num("مبلغ معتبر").pipe(z.number().min(1_000)),
    walletMax: num("مبلغ معتبر").pipe(z.number().min(10_000)),
    proMonthlyPrice: num("مبلغ معتبر").pipe(z.number().min(1_000, "حداقل ۱٬۰۰۰ تومان")),
  })
  .refine((v) => v.walletMax > v.walletMin, {
    message: "سقف باید بیشتر از حداقل باشد",
    path: ["walletMax"],
  });

type Values = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

export default function GeneralPage() {
  const { data: settings, isLoading } = useSettings();
  const save = useSaveSettings();
  const qc = useQueryClient();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const form = useForm<Values, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      brandName: "",
      supportPhone: "",
      minOrder: 0,
      walletMin: 0,
      walletMax: 0,
      proMonthlyPrice: 0,
    },
  });
  const errors = form.formState.errors;

  useEffect(() => {
    if (settings) form.reset(settings);
  }, [settings, form]);

  return (
    <>
      <PageHeader title="تنظیمات" description="پیکربندی پلتفرم، کارکنان و گزارش فعالیت" />
      <SettingsTabs />
      {isLoading ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <form className="flex flex-col gap-4 xl:col-span-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>پلتفرم</CardTitle>
                  <CardDescription>این مقادیر در اپ فروشگاه‌ها هم اعمال می‌شوند</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField label="نام برند" htmlFor="s-brand" error={errors.brandName?.message}>
                  <Input id="s-brand" {...form.register("brandName")} />
                </FormField>
                <FormField label="تلفن پشتیبانی" htmlFor="s-phone" error={errors.supportPhone?.message}>
                  <Input id="s-phone" dir="ltr" {...form.register("supportPhone")} />
                </FormField>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>سفارش و کیف پول</CardTitle>
                  <CardDescription>محدودیت‌های مالی سفارش‌گذاری</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <FormField label="حداقل سبد خرید (تومان)" htmlFor="s-min" error={errors.minOrder?.message}>
                  <Input id="s-min" inputMode="numeric" {...form.register("minOrder")} />
                </FormField>
                <FormField label="حداقل شارژ کیف پول" htmlFor="s-wmin" error={errors.walletMin?.message}>
                  <Input id="s-wmin" inputMode="numeric" {...form.register("walletMin")} />
                </FormField>
                <FormField label="سقف شارژ کیف پول" htmlFor="s-wmax" error={errors.walletMax?.message}>
                  <Input id="s-wmax" inputMode="numeric" {...form.register("walletMax")} />
                </FormField>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>اشتراک پرو فروشگاه</CardTitle>
                  <CardDescription>
                    نرخ ماهانه برای باز کردن بازار شهر — جدا از نشان تحویل سریع شرکت‌های پخش
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <FormField
                  label="قیمت ماهانه اشتراک پرو (تومان)"
                  htmlFor="s-pro"
                  error={errors.proMonthlyPrice?.message}
                >
                  <Input id="s-pro" inputMode="numeric" {...form.register("proMonthlyPrice")} />
                </FormField>
              </CardContent>
            </Card>
            <div className="flex justify-start gap-2">
              <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
                ذخیره تنظیمات
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!form.formState.isDirty}
                onClick={() => settings && form.reset(settings)}
              >
                بازگردانی
              </Button>
            </div>
          </form>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>ظاهر پنل</CardTitle>
                  <CardDescription>فقط برای این مرورگر</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={theme} onValueChange={(v) => setTheme(v as "light" | "dark")}>
                  <TabsList className="w-full">
                    <TabsTrigger value="light" className="flex-1">
                      <Sun /> روشن
                    </TabsTrigger>
                    <TabsTrigger value="dark" className="flex-1">
                      <Moon /> تیره
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="size-4 text-label-secondary" /> داده‌های نمایشی
                  </CardTitle>
                  <CardDescription>همه تغییرات این مرورگر پاک و داده‌های اولیه بازگردانی می‌شود</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive-soft"
                  className="w-full"
                  onClick={async () => {
                    await api.resetDemoData();
                    await qc.invalidateQueries();
                    toast.success("داده‌های نمایشی بازنشانی شد");
                  }}
                >
                  بازنشانی داده‌های نمایشی
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
