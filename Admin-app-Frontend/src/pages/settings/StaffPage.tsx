import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import FormField from "@/components/shared/FormField";
import DataTable from "@/components/data-table/DataTable";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveStaff, useStaff } from "@/features/people";
import { useAllDistributors } from "@/features/catalog";
import { useSessionStore } from "@/store/useSessionStore";
import { ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { isValidIranMobile } from "@/lib/phone";
import { formatPhoneDisplay } from "@/lib/phone";
import { relativeLabel } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import type { Role, Staff } from "@/types";
import SettingsTabs from "./components/SettingsTabs";

const schema = z
  .object({
    name: z.string().trim().min(3, "نام کامل را وارد کنید"),
    phone: z.string().trim().refine(isValidIranMobile, "شماره موبایل معتبر نیست"),
    role: z.enum(["super_admin", "distributor_admin"]),
    distributorId: z.string().optional(),
    active: z.boolean(),
  })
  .refine((v) => v.role !== "distributor_admin" || Boolean(v.distributorId), {
    message: "شرکت پخش را انتخاب کنید",
    path: ["distributorId"],
  });
type Values = z.infer<typeof schema>;

export default function StaffPage() {
  const me = useSessionStore((s) => s.session?.staff);
  const { data: staff, isLoading } = useStaff();
  const { data: distributors } = useAllDistributors();
  const save = useSaveStaff();
  const [editing, setEditing] = useState<Staff | null | "new">(null);

  const columns = useMemo<ColumnDef<Staff, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "کاربر",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.name} size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                {row.original.name}
                {row.original.id === me?.id ? (
                  <Badge variant="outline" className="text-[10px]">
                    شما
                  </Badge>
                ) : null}
              </div>
              <div className="ltr text-right text-[12px] text-label-secondary">
                {formatPhoneDisplay(row.original.phone)}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "نقش",
        cell: ({ row }) => (
          <Badge variant={row.original.role === "super_admin" ? "solid" : "neutral"}>{row.original.roleLabel}</Badge>
        ),
      },
      {
        id: "distributor",
        header: "شرکت پخش",
        accessorFn: (s) => s.distributorId ?? "",
        cell: ({ row }) => (
          <span className="text-label-secondary">
            {row.original.distributorId
              ? (distributors?.find((d) => d.id === row.original.distributorId)?.name ?? "—")
              : "همه"}
          </span>
        ),
      },
      {
        id: "perms",
        header: "دسترسی‌ها",
        accessorFn: (s) => ROLE_PERMISSIONS[s.role].length,
        cell: ({ getValue }) => (
          <span className="text-label-secondary tabular-nums">{toFaNum(getValue<number>())} مجوز</span>
        ),
      },
      {
        accessorKey: "lastLoginAt",
        header: "آخرین ورود",
        cell: ({ getValue }) => (
          <span className="text-label-secondary">
            {getValue<string | undefined>() ? relativeLabel(getValue<string>()) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "active",
        header: "وضعیت",
        cell: ({ getValue }) =>
          getValue<boolean>() ? <Badge variant="neutral">فعال</Badge> : <Badge variant="muted">غیرفعال</Badge>,
      },
    ],
    [distributors, me?.id],
  );

  return (
    <>
      <PageHeader
        title="تنظیمات"
        description="پیکربندی پلتفرم، کارکنان و گزارش فعالیت"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> دعوت کاربر
          </Button>
        }
      />
      <SettingsTabs />
      <DataTable columns={columns} data={staff ?? []} loading={isLoading} onRowClick={(s) => setEditing(s)} />
      <StaffDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        staff={editing === "new" ? undefined : (editing ?? undefined)}
        save={save}
        distributors={distributors ?? []}
        isSelf={editing !== "new" && editing?.id === me?.id}
      />
    </>
  );
}

function StaffDialog({
  open,
  onOpenChange,
  staff,
  save,
  distributors,
  isSelf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  staff?: Staff;
  save: ReturnType<typeof useSaveStaff>;
  distributors: { id: string; name: string }[];
  isSelf: boolean;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      role: "distributor_admin",
      distributorId: undefined,
      active: true,
    },
  });
  const errors = form.formState.errors;
  const role = form.watch("role");

  useEffect(() => {
    if (open)
      form.reset(
        staff
          ? {
              name: staff.name,
              phone: staff.phone,
              role: staff.role,
              distributorId: staff.distributorId,
              active: staff.active,
            }
          : {
              name: "",
              phone: "",
              role: "distributor_admin",
              distributorId: undefined,
              active: true,
            },
      );
  }, [open, staff, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{staff ? "ویرایش کاربر" : "دعوت کاربر جدید"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            await save.mutateAsync({
              id: staff?.id,
              name: v.name,
              phone: v.phone,
              role: v.role,
              distributorId: v.role === "super_admin" ? undefined : v.distributorId,
              active: v.active,
              lastLoginAt: staff?.lastLoginAt,
            });
            onOpenChange(false);
          })}
        >
          <FormField label="نام کامل" htmlFor="st-name" error={errors.name?.message}>
            <Input id="st-name" {...form.register("name")} />
          </FormField>
          <FormField label="شماره موبایل (برای ورود با OTP)" htmlFor="st-phone" error={errors.phone?.message}>
            <Input id="st-phone" dir="ltr" inputMode="tel" {...form.register("phone")} />
          </FormField>
          <FormField
            label="نقش"
            error={errors.role?.message}
            hint={role === "super_admin" ? "دسترسی کامل به همه شرکت‌های پخش" : "فقط داده‌های شرکت پخش خودش"}
          >
            <Select
              value={role}
              disabled={isSelf}
              onValueChange={(v) => form.setValue("role", v as Role, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {role === "distributor_admin" ? (
            <FormField label="شرکت پخش" error={errors.distributorId?.message}>
              <Select
                value={form.watch("distributorId") ?? ""}
                onValueChange={(v) => form.setValue("distributorId", v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب شرکت پخش" />
                </SelectTrigger>
                <SelectContent>
                  {distributors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <div className="flex items-center justify-between rounded-xl bg-input px-3.5 py-2.5">
            <Label>حساب فعال</Label>
            <Switch
              checked={form.watch("active")}
              disabled={isSelf}
              onCheckedChange={(v) => form.setValue("active", v)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {staff ? "ذخیره" : "دعوت"}
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
