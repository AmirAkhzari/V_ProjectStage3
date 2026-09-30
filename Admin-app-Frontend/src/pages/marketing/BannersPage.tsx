import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import FormField from "@/components/shared/FormField";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBanners, useDeleteBanner, useReorderBanners, useSaveBanner } from "@/features/marketing";
import { toFaNum } from "@/lib/format";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";

const schema = z.object({
  title: z.string().trim().min(2, "عنوان را وارد کنید").max(30, "حداکثر ۳۰ کاراکتر"),
  subtitle: z.string().trim().min(4, "زیرعنوان را وارد کنید").max(80, "حداکثر ۸۰ کاراکتر"),
  cta: z.string().trim().min(2, "متن دکمه").max(12, "حداکثر ۱۲ کاراکتر"),
  active: z.boolean(),
});
type Values = z.infer<typeof schema>;

export default function BannersPage() {
  const { data: banners, isLoading } = useBanners();
  const reorder = useReorderBanners();
  const remove = useDeleteBanner();
  const [editing, setEditing] = useState<Banner | null | "new">(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);
  const save = useSaveBanner();

  const move = (index: number, dir: -1 | 1) => {
    if (!banners) return;
    const ids = banners.map((b) => b.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader
        title="بنرها"
        description="بنرهای اسلایدر صفحه اصلی اپ فروشگاه‌ها؛ ترتیب نمایش با فلش‌ها تغییر می‌کند"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> بنر جدید
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : banners?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {banners.map((b, i) => (
            <Card key={b.id} className={cn("flex flex-col gap-3 p-4", !b.active && "opacity-60")}>
              <div
                className="relative overflow-hidden rounded-xl bg-primary p-5 text-primary-foreground"
                style={{ minHeight: 120 }}
              >
                <span className="absolute top-3 left-3 text-[11px] tabular-nums opacity-60">{toFaNum(i + 1)}</span>
                <div className="text-[18px] font-black">{b.title}</div>
                <div className="mt-1 max-w-[80%] text-[12px] opacity-80">{b.subtitle}</div>
                <span className="mt-3 inline-block rounded-full bg-primary-foreground px-3 py-1 text-[11px] font-bold text-primary">
                  {b.cta}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <Badge variant={b.active ? "neutral" : "muted"}>{b.active ? "فعال" : "پنهان"}</Badge>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="بالا"
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(i, 1)}
                    disabled={i === banners.length - 1}
                    aria-label="پایین"
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => save.mutate({ ...b, active: !b.active })}
                    aria-label={b.active ? "پنهان" : "نمایش"}
                  >
                    {b.active ? <EyeOff /> : <Eye />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(b)} aria-label="ویرایش">
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    onClick={() => setDeleting(b)}
                    aria-label="حذف"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="بنری تعریف نشده" action={<Button onClick={() => setEditing("new")}>بنر جدید</Button>} />
      )}

      <BannerDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        banner={editing === "new" ? undefined : (editing ?? undefined)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="حذف بنر"
        description={`بنر «${deleting?.title}» از اپ حذف می‌شود.`}
        confirmLabel="حذف"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}

function BannerDialog({
  open,
  onOpenChange,
  banner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  banner?: Banner;
}) {
  const save = useSaveBanner();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", subtitle: "", cta: "خرید", active: true },
  });
  const errors = form.formState.errors;

  useEffect(() => {
    if (open)
      form.reset(
        banner
          ? {
              title: banner.title,
              subtitle: banner.subtitle,
              cta: banner.cta,
              active: banner.active,
            }
          : { title: "", subtitle: "", cta: "خرید", active: true },
      );
  }, [open, banner, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{banner ? "ویرایش بنر" : "بنر جدید"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            await save.mutateAsync({ ...v, id: banner?.id });
            onOpenChange(false);
          })}
        >
          <FormField label="عنوان" htmlFor="b-title" error={errors.title?.message}>
            <Input id="b-title" {...form.register("title")} />
          </FormField>
          <FormField label="زیرعنوان" htmlFor="b-sub" error={errors.subtitle?.message}>
            <Input id="b-sub" {...form.register("subtitle")} />
          </FormField>
          <FormField label="متن دکمه" htmlFor="b-cta" error={errors.cta?.message}>
            <Input id="b-cta" {...form.register("cta")} />
          </FormField>
          <div className="flex items-center justify-between rounded-xl bg-input px-3.5 py-2.5">
            <Label>نمایش در اپ</Label>
            <Switch checked={form.watch("active")} onCheckedChange={(v) => form.setValue("active", v)} />
          </div>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {banner ? "ذخیره" : "ایجاد"}
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
