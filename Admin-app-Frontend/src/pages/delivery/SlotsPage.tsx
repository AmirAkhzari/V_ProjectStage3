import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Plus, X } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDistributors } from "@/features/catalog";
import { useSaveSlots, useSlots } from "@/features/ops";
import { useIsDistributorAdmin } from "@/store/useSessionStore";
import { JALALI_WEEKDAYS, daysAhead, formatJalali, toGregorian, toJalali, JALALI_MONTHS } from "@/lib/jalali";
import { toAsciiDigits, toFaDigits, toFaNum } from "@/lib/format";
import type { DeliverySlotConfig } from "@/types";
import { cn } from "@/lib/utils";

const ALL_SLOTS = Array.from({ length: 19 }, (_, i) => {
  const mins = 9 * 60 + 45 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

export default function SlotsPage() {
  const isDistributor = useIsDistributorAdmin();
  const { data: distributors } = useDistributors();
  const [distributorId, setDistributorId] = useState("");
  useEffect(() => {
    if (!distributorId && distributors?.length) setDistributorId(distributors[0].id);
  }, [distributors, distributorId]);

  const { data: config, isLoading } = useSlots(distributorId || undefined);
  const save = useSaveSlots();
  const [draft, setDraft] = useState<DeliverySlotConfig | null>(null);
  useEffect(() => {
    if (config) setDraft(structuredClone(config));
  }, [config]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);

  const toggle = (day: number, slot: string) => {
    if (!draft) return;
    const cur = draft.days[day] ?? [];
    const next = cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur, slot].sort();
    setDraft({ ...draft, days: { ...draft.days, [day]: next } });
  };
  const setDay = (day: number, slots: string[]) =>
    draft && setDraft({ ...draft, days: { ...draft.days, [day]: slots } });
  const copyToAll = (day: number) =>
    draft &&
    setDraft({
      ...draft,
      days: Object.fromEntries(Array.from({ length: 7 }, (_, d) => [d, [...(draft.days[day] ?? [])]])),
    });

  const distributor = distributors?.find((d) => d.id === distributorId);

  return (
    <>
      <PageHeader
        title="بازه‌های تحویل"
        description="ساعت‌های تحویل هر روز هفته و روزهای تعطیل برای هر شرکت پخش؛ در اپ فروشگاه‌ها فقط بازه‌های فعال نمایش داده می‌شود"
        actions={
          <>
            <Button variant="ghost" disabled={!dirty} onClick={() => config && setDraft(structuredClone(config))}>
              بازگردانی
            </Button>
            <Button disabled={!dirty} loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
              ذخیره تغییرات
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!isDistributor ? (
          <Select value={distributorId} onValueChange={setDistributorId}>
            <SelectTrigger className="w-60 bg-card">
              <SelectValue placeholder="شرکت پخش" />
            </SelectTrigger>
            <SelectContent>
              {distributors?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-[15px] font-semibold">{distributor?.name}</span>
        )}
        {draft ? (
          <Badge variant="muted">
            {toFaNum(Object.values(draft.days).reduce((s, d) => s + d.length, 0))} بازه فعال در هفته
          </Badge>
        ) : null}
      </div>

      {isLoading || !draft ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-4">
          <Card className="overflow-x-auto xl:col-span-3">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky right-0 z-10 bg-card px-3 py-2 text-right font-semibold text-label-secondary">
                    ساعت
                  </th>
                  {JALALI_WEEKDAYS.map((d, i) => (
                    <th key={d} className="px-1 py-2 text-center font-semibold">
                      <div>{d}</div>
                      <div className="mt-1 flex justify-center gap-0.5">
                        <button
                          type="button"
                          className="rounded px-1 text-[10px] text-label-secondary hover:bg-fill"
                          onClick={() => setDay(i, [...ALL_SLOTS])}
                        >
                          همه
                        </button>
                        <button
                          type="button"
                          className="rounded px-1 text-[10px] text-label-secondary hover:bg-fill"
                          onClick={() => setDay(i, [])}
                        >
                          هیچ
                        </button>
                        <button
                          type="button"
                          className="rounded px-1 text-[10px] text-label-secondary hover:bg-fill"
                          onClick={() => copyToAll(i)}
                          title="کپی به همه روزها"
                        >
                          کپی
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_SLOTS.map((slot) => (
                  <tr key={slot} className="border-b border-border last:border-0">
                    <td className="sticky right-0 z-10 bg-card px-3 py-1 font-medium tabular-nums">
                      {toFaDigits(slot)}
                    </td>
                    {JALALI_WEEKDAYS.map((_, day) => {
                      const on = (draft.days[day] ?? []).includes(slot);
                      return (
                        <td key={day} className="px-1 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => toggle(day, slot)}
                            aria-pressed={on}
                            aria-label={`${JALALI_WEEKDAYS[day]} ${slot}`}
                            className={cn(
                              "mx-auto block h-7 w-full max-w-16 rounded-md transition-colors",
                              on ? "bg-primary" : "bg-fill hover:bg-fill-secondary",
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarOff className="size-4 text-label-secondary" /> روزهای تعطیل
                </CardTitle>
                <CardDescription>در این روزها هیچ بازه‌ای ارائه نمی‌شود</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <HolidayPicker
                onAdd={(iso) =>
                  !draft.holidays.includes(iso) &&
                  setDraft({
                    ...draft,
                    holidays: [...draft.holidays, iso].sort(),
                  })
                }
              />
              <ul className="flex flex-col gap-1.5">
                {draft.holidays.length ? (
                  draft.holidays.map((h) => (
                    <li key={h} className="flex items-center justify-between rounded-lg bg-fill px-3 py-2 text-[13px]">
                      <span>{formatJalali(h, { withWeekday: true })}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            holidays: draft.holidays.filter((x) => x !== h),
                          })
                        }
                        className="rounded p-0.5 text-label-secondary hover:text-destructive"
                        aria-label="حذف"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="text-[12px] text-label-tertiary">تعطیلی ثبت نشده</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function HolidayPicker({ onAdd }: { onAdd: (iso: string) => void }) {
  const today = toJalali(new Date());
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [day, setDay] = useState(String(today.day));
  const d = Number(toAsciiDigits(day));
  const valid = d >= 1 && d <= 31;
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-1.5">
        <Input
          value={toFaDigits(String(d || ""))}
          onChange={(e) => setDay(toAsciiDigits(e.target.value).replace(/\D/g, "").slice(0, 2))}
          inputMode="numeric"
          placeholder="روز"
          className="h-9 text-center"
        />
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger size="sm" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JALALI_MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger size="sm" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[today.year, today.year + 1].map((y) => (
              <SelectItem key={y} value={String(y)}>
                {toFaDigits(y)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={!valid}
        onClick={() => {
          const g = toGregorian({ year, month, day: d });
          onAdd(g.toISOString().slice(0, 10));
        }}
      >
        <Plus /> افزودن تعطیلی
      </Button>
      <p className="text-[11px] text-label-tertiary">امروز: {formatJalali(daysAhead(0), { withWeekday: true })}</p>
    </div>
  );
}
