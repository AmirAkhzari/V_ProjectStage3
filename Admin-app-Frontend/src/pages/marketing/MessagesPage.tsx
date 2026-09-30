import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Bell, Megaphone, Package, Send } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import FormField from "@/components/shared/FormField";
import EmptyState from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMessages, useSendMessage } from "@/features/marketing";
import { useAllDistributors } from "@/features/catalog";
import { useCities } from "@/features/ops";
import { useSessionStore } from "@/store/useSessionStore";
import { formatJalaliDateTime } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import type { MessageAudience, MessageKind } from "@/types";

const schema = z.object({
  title: z.string().trim().min(3, "عنوان حداقل ۳ کاراکتر").max(60, "حداکثر ۶۰ کاراکتر"),
  body: z.string().trim().min(10, "متن حداقل ۱۰ کاراکتر").max(240, "حداکثر ۲۴۰ کاراکتر"),
  kind: z.enum(["promo", "stock", "order"]),
  audienceType: z.enum(["all", "city", "distributor"]),
  city: z.string().optional(),
  distributorId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const KIND_META: Record<MessageKind, { label: string; icon: typeof Bell }> = {
  promo: { label: "تبلیغاتی", icon: Megaphone },
  stock: { label: "موجودی", icon: Package },
  order: { label: "سفارش", icon: Bell },
};

export default function MessagesPage() {
  const session = useSessionStore((s) => s.session);
  const isDistributor = session?.staff.role === "distributor_admin";
  const { data: messages, isLoading } = useMessages();
  const { data: distributors } = useAllDistributors();
  const { data: cities } = useCities();
  const send = useSendMessage();
  const [confirming, setConfirming] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      body: "",
      kind: "promo",
      audienceType: isDistributor ? "distributor" : "all",
      distributorId: session?.staff.distributorId,
      city: undefined,
    },
  });
  const errors = form.formState.errors;
  const audienceType = form.watch("audienceType");
  const body = form.watch("body");

  const onSubmit = async (v: Values) => {
    const audience: MessageAudience =
      v.audienceType === "all"
        ? { type: "all" }
        : v.audienceType === "city"
          ? { type: "city", city: v.city ?? "" }
          : { type: "distributor", distributorId: v.distributorId ?? "" };
    if (audience.type === "city" && !audience.city) {
      form.setError("city", { message: "شهر را انتخاب کنید" });
      return;
    }
    if (audience.type === "distributor" && !audience.distributorId) {
      form.setError("distributorId", { message: "شرکت پخش را انتخاب کنید" });
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await send.mutateAsync({
      title: v.title,
      body: v.body,
      kind: v.kind,
      audience,
    });
    setConfirming(false);
    form.reset({ ...v, title: "", body: "" });
  };

  const describeAudience = (a: MessageAudience) =>
    a.type === "all"
      ? "همه فروشگاه‌ها"
      : a.type === "city"
        ? `فروشگاه‌های ${a.city}`
        : `مشتریان ${distributors?.find((d) => d.id === a.distributorId)?.name ?? "شرکت پخش"}`;

  return (
    <>
      <PageHeader
        title="پیام‌ها"
        description="ارسال اعلان درون‌برنامه‌ای به فروشگاه‌ها؛ در صندوق پیام اپ نمایش داده می‌شود"
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>پیام جدید</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} onChange={() => setConfirming(false)}>
              <FormField label="نوع">
                <Tabs value={form.watch("kind")} onValueChange={(v) => form.setValue("kind", v as MessageKind)}>
                  <TabsList className="w-full">
                    {(Object.keys(KIND_META) as MessageKind[]).map((k) => (
                      <TabsTrigger key={k} value={k} className="flex-1">
                        {KIND_META[k].label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </FormField>
              <FormField label="عنوان" htmlFor="m-title" error={errors.title?.message}>
                <Input id="m-title" {...form.register("title")} />
              </FormField>
              <FormField
                label="متن پیام"
                htmlFor="m-body"
                error={errors.body?.message}
                hint={`${toFaNum(body.length)} / ۲۴۰`}
              >
                <Textarea id="m-body" {...form.register("body")} />
              </FormField>
              <FormField label="گیرندگان">
                <Select
                  value={audienceType}
                  disabled={isDistributor}
                  onValueChange={(v) => form.setValue("audienceType", v as Values["audienceType"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه فروشگاه‌ها</SelectItem>
                    <SelectItem value="city">فروشگاه‌های یک شهر</SelectItem>
                    <SelectItem value="distributor">مشتریان یک شرکت پخش</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {audienceType === "city" ? (
                <FormField label="شهر" error={errors.city?.message}>
                  <Select
                    value={form.watch("city") ?? ""}
                    onValueChange={(v) => form.setValue("city", v, { shouldValidate: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="انتخاب شهر" />
                    </SelectTrigger>
                    <SelectContent>
                      {cities?.map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}
              {audienceType === "distributor" ? (
                <FormField label="شرکت پخش" error={errors.distributorId?.message}>
                  <Select
                    value={form.watch("distributorId") ?? ""}
                    disabled={isDistributor}
                    onValueChange={(v) =>
                      form.setValue("distributorId", v, {
                        shouldValidate: true,
                      })
                    }
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
              <Button type="submit" variant={confirming ? "destructive" : "primary"} loading={send.isPending}>
                <Send /> {confirming ? "تایید و ارسال نهایی" : "ارسال پیام"}
              </Button>
              {confirming ? (
                <p className="text-center text-[12px] text-label-secondary">
                  پیام پس از ارسال قابل بازگشت نیست. برای تایید دوباره کلیک کنید.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>پیام‌های ارسال‌شده</CardTitle>
            <span className="text-[12px] text-label-secondary">{toFaNum(messages?.length ?? 0)} پیام</span>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-14" />)
            ) : messages?.length ? (
              messages.map((m) => {
                const Icon = KIND_META[m.kind].icon;
                return (
                  <div key={m.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="text-[13px] font-semibold">{m.title}</span>
                        <span className="text-[11px] text-label-secondary tabular-nums">
                          {formatJalaliDateTime(m.sentAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-5 text-label-secondary">{m.body}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="muted">{KIND_META[m.kind].label}</Badge>
                        <Badge variant="outline">{describeAudience(m.audience)}</Badge>
                        <span className="text-[11px] text-label-tertiary tabular-nums">
                          {toFaNum(m.recipients)} گیرنده
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState title="هنوز پیامی ارسال نشده" className="py-10" />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
