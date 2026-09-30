import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PageHeader from "@/components/shared/PageHeader";
import FormField from "@/components/shared/FormField";
import EmptyState from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProduct, useSaveProduct } from "@/features/catalog";
import { useCan } from "@/store/useSessionStore";
import { CATEGORIES, SUB_CATEGORIES } from "@/services/seed/catalog";
import { toAsciiDigits, toFaNum } from "@/lib/format";
import { paths } from "@/routes/paths";

const numeric = (msg: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(toAsciiDigits(v).replace(/[^\d.]/g, "")) : v),
    z.number({ error: msg }).nonnegative(msg),
  );

const schema = z.object({
  name: z.string().trim().min(3, "نام کالا حداقل ۳ کاراکتر"),
  brand: z.string().trim().min(1, "برند را وارد کنید"),
  sku: z.string().trim().min(2, "SKU را وارد کنید"),
  category: z.string().min(1, "دسته را انتخاب کنید"),
  subCategory: z.string().min(1, "زیردسته را انتخاب کنید"),
  size: z.string().trim().min(1, "اندازه/حجم را وارد کنید"),
  unitsPerCarton: numeric("عدد معتبر وارد کنید").pipe(z.number().int().min(1, "حداقل ۱")),
  minOrderQty: numeric("عدد معتبر وارد کنید").pipe(z.number().int().min(1, "حداقل ۱")),
  price: numeric("قیمت معتبر وارد کنید").pipe(z.number().min(1000, "قیمت باید بیشتر از ۱٬۰۰۰ تومان باشد")),
  original: numeric("قیمت معتبر وارد کنید").optional(),
  img: z.string().trim().min(1, "آدرس تصویر را وارد کنید"),
  description: z.string().trim().optional(),
  active: z.boolean(),
});

type FormValues = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

export default function ProductFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const canManage = useCan("products.manage");
  const { data: product, isLoading } = useProduct(id);
  const save = useSaveProduct();

  const form = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      brand: "",
      sku: "",
      category: "",
      subCategory: "",
      size: "",
      unitsPerCarton: 12,
      minOrderQty: 1,
      price: 0,
      original: undefined,
      img: "/images/dairy/dkp_2726997.webp",
      description: "",
      active: true,
    },
  });

  useEffect(() => {
    if (product) {
      form.reset({
        ...product,
        original: product.original ?? undefined,
        description: product.description ?? "",
      });
    }
  }, [product, form]);

  const category = form.watch("category");
  const price = Number(form.watch("price")) || 0;
  const original = Number(form.watch("original")) || 0;
  const img = form.watch("img");
  const disc = original > price && price > 0 ? Math.round(((original - price) / original) * 100) : undefined;

  if (!isNew && isLoading) return <Skeleton className="h-96" />;
  if (!isNew && !product) {
    return (
      <EmptyState
        title="محصول پیدا نشد"
        className="py-32"
        action={
          <Button asChild variant="secondary">
            <Link to={paths.products}>بازگشت</Link>
          </Button>
        }
      />
    );
  }

  const onSubmit = async (values: Parsed) => {
    const saved = await save.mutateAsync({
      ...values,
      id,
      original: values.original && values.original > values.price ? values.original : undefined,
      disc,
      description: values.description || undefined,
    });
    navigate(paths.product(saved.id), { replace: true });
  };

  const errors = form.formState.errors;
  const readOnly = !canManage;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <PageHeader
        crumbs={[{ label: "محصولات", to: paths.products }, { label: isNew ? "محصول جدید" : product!.name }]}
        title={isNew ? "محصول جدید" : product!.name}
        actions={
          canManage ? (
            <>
              <Button type="submit" loading={save.isPending}>
                {isNew ? "ایجاد محصول" : "ذخیره تغییرات"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate(paths.products)}>
                انصراف
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>مشخصات</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="نام کالا" htmlFor="name" error={errors.name?.message} className="sm:col-span-2">
                <Input id="name" readOnly={readOnly} {...form.register("name")} />
              </FormField>
              <FormField label="برند" htmlFor="brand" error={errors.brand?.message}>
                <Input id="brand" readOnly={readOnly} {...form.register("brand")} />
              </FormField>
              <FormField label="SKU" htmlFor="sku" error={errors.sku?.message}>
                <Input id="sku" dir="ltr" readOnly={readOnly} {...form.register("sku")} />
              </FormField>
              <FormField label="دسته" error={errors.category?.message}>
                <Select
                  value={category}
                  disabled={readOnly}
                  onValueChange={(v) => {
                    form.setValue("category", v, { shouldValidate: true });
                    form.setValue("subCategory", "", { shouldValidate: false });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب دسته" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="زیردسته" error={errors.subCategory?.message}>
                <Select
                  value={form.watch("subCategory")}
                  disabled={readOnly || !category}
                  onValueChange={(v) => form.setValue("subCategory", v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب زیردسته" />
                  </SelectTrigger>
                  <SelectContent>
                    {(SUB_CATEGORIES[category] ?? []).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="اندازه / حجم" htmlFor="size" error={errors.size?.message} hint="مثال: ۳۳۰ میلی لیتری">
                <Input id="size" readOnly={readOnly} {...form.register("size")} />
              </FormField>
              <FormField label="تعداد در کارتن" htmlFor="upc" error={errors.unitsPerCarton?.message}>
                <Input id="upc" inputMode="numeric" readOnly={readOnly} {...form.register("unitsPerCarton")} />
              </FormField>
              <FormField label="توضیحات" htmlFor="description" className="sm:col-span-2">
                <Textarea id="description" readOnly={readOnly} {...form.register("description")} />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>قیمت و سفارش</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <FormField label="قیمت کارتن (تومان)" htmlFor="price" error={errors.price?.message}>
                <Input id="price" inputMode="numeric" readOnly={readOnly} {...form.register("price")} />
              </FormField>
              <FormField
                label="قیمت قبل از تخفیف"
                htmlFor="original"
                error={errors.original?.message}
                hint={disc ? `${toFaNum(disc)}٪ تخفیف` : "اختیاری"}
              >
                <Input id="original" inputMode="numeric" readOnly={readOnly} {...form.register("original")} />
              </FormField>
              <FormField label="حداقل سفارش (کارتن)" htmlFor="moq" error={errors.minOrderQty?.message}>
                <Input id="moq" inputMode="numeric" readOnly={readOnly} {...form.register("minOrderQty")} />
              </FormField>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>تصویر</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-fill">
                {img ? (
                  <img
                    src={img}
                    alt=""
                    className="size-full object-cover"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                  />
                ) : null}
              </div>
              <FormField label="آدرس تصویر" htmlFor="img" error={errors.img?.message}>
                <Input id="img" dir="ltr" readOnly={readOnly} {...form.register("img")} />
              </FormField>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between pt-5">
              <div>
                <div className="text-[13px] font-medium">نمایش در اپ فروشگاه‌ها</div>
                <div className="text-[12px] text-label-secondary">محصول غیرفعال در کاتالوگ دیده نمی‌شود</div>
              </div>
              <Switch
                checked={form.watch("active")}
                disabled={readOnly}
                onCheckedChange={(v) => form.setValue("active", v)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
