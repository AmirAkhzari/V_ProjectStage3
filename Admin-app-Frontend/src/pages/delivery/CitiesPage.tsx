import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import FormField from "@/components/shared/FormField";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCities, useDeleteCity, useSaveCity } from "@/features/ops";
import { useAllDistributors } from "@/features/catalog";
import { useRetailers } from "@/features/people";
import { normalizePersian, toAsciiDigits, toFaDigits, toFaNum } from "@/lib/format";
import type { City } from "@/types";

const coord = (min: number, max: number, msg: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(toAsciiDigits(v)) : v),
    z.number({ error: msg }).min(min, msg).max(max, msg),
  );
const schema = z.object({
  name: z.string().trim().min(2, "نام شهر را وارد کنید"),
  province: z.string().trim().min(2, "نام استان را وارد کنید"),
  lat: coord(24, 40, "عرض جغرافیایی نامعتبر (۲۴ تا ۴۰)"),
  lng: coord(44, 64, "طول جغرافیایی نامعتبر (۴۴ تا ۶۴)"),
});
type Values = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

export default function CitiesPage() {
  const { data: cities, isLoading } = useCities();
  const { data: distributors } = useAllDistributors();
  const { data: retailers } = useRetailers();
  const remove = useDeleteCity();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<City | null>(null);

  const coverage = useMemo(() => {
    const m = new Map<string, { distributors: number; retailers: number }>();
    for (const c of cities ?? [])
      m.set(c.name, {
        distributors: (distributors ?? []).filter((d) => d.cities.includes(c.name)).length,
        retailers: (retailers ?? []).filter((r) => r.city === c.name).length,
      });
    return m;
  }, [cities, distributors, retailers]);

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (cities ?? []).filter((c) => !q || normalizePersian(`${c.name} ${c.province}`).includes(q));
  }, [cities, query]);

  const columns = useMemo<ColumnDef<City, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "شهر",
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      },
      {
        accessorKey: "province",
        header: "استان",
        cell: ({ getValue }) => <span className="text-label-secondary">{getValue<string>()}</span>,
      },
      {
        id: "coords",
        header: "مختصات",
        accessorFn: (c) => c.lat,
        cell: ({ row }) => (
          <span className="ltr inline-block text-[12px] text-label-secondary tabular-nums">
            {toFaDigits(`${row.original.lat.toFixed(4)}, ${row.original.lng.toFixed(4)}`)}
          </span>
        ),
      },
      {
        id: "distributors",
        header: "شرکت‌های پخش",
        accessorFn: (c) => coverage.get(c.name)?.distributors ?? 0,
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return <Badge variant={n ? "neutral" : "danger"}>{n ? `${toFaNum(n)} شرکت` : "بدون پوشش"}</Badge>;
        },
      },
      {
        id: "retailers",
        header: "فروشگاه‌ها",
        accessorFn: (c) => coverage.get(c.name)?.retailers ?? 0,
        cell: ({ getValue }) => <span className="tabular-nums">{toFaNum(getValue<number>())}</span>,
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            disabled={(coverage.get(row.original.name)?.distributors ?? 0) > 0}
            onClick={() => setDeleting(row.original)}
            aria-label="حذف"
          >
            <Trash2 />
          </Button>
        ),
      },
    ],
    [coverage],
  );

  return (
    <>
      <PageHeader
        title="شهرها"
        description="شهرهای قابل انتخاب در اپ فروشگاه‌ها؛ شهرهایی که شرکت پخش دارند قابل حذف نیستند"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> شهر جدید
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        toolbar={<SearchInput value={query} onChange={setQuery} placeholder="شهر یا استان" />}
      />
      <CityDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="حذف شهر"
        description={`شهر «${deleting?.name}» از فهرست انتخاب فروشگاه‌ها حذف می‌شود.`}
        confirmLabel="حذف"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.name);
          setDeleting(null);
        }}
      />
    </>
  );
}

function CityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const save = useSaveCity();
  const form = useForm<Values, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", province: "", lat: 35.7, lng: 51.4 },
  });
  const errors = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) form.reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>شهر جدید</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            await save.mutateAsync(v);
            form.reset();
            onOpenChange(false);
          })}
        >
          <FormField label="نام شهر" htmlFor="city-name" error={errors.name?.message}>
            <Input id="city-name" {...form.register("name")} />
          </FormField>
          <FormField label="استان" htmlFor="city-prov" error={errors.province?.message}>
            <Input id="city-prov" {...form.register("province")} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="عرض جغرافیایی" htmlFor="city-lat" error={errors.lat?.message}>
              <Input id="city-lat" dir="ltr" {...form.register("lat")} />
            </FormField>
            <FormField label="طول جغرافیایی" htmlFor="city-lng" error={errors.lng?.message}>
              <Input id="city-lng" dir="ltr" {...form.register("lng")} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              ایجاد
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
