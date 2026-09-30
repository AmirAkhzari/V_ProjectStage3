import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/data-table/DataTable";
import SearchInput from "@/components/data-table/SearchInput";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuditLog } from "@/features/people";
import { normalizePersian } from "@/lib/format";
import { formatJalaliDateTime } from "@/lib/jalali";
import { paths } from "@/routes/paths";
import type { AuditEntry } from "@/types";
import SettingsTabs from "./components/SettingsTabs";

const ENTITY_LABELS: Record<string, string> = {
  order: "سفارش",
  product: "محصول",
  stock: "موجودی",
  distributor: "شرکت پخش",
  retailer: "فروشگاه",
  coupon: "کد تخفیف",
  banner: "بنر",
  message: "پیام",
  wallet: "کیف پول",
  delivery: "تحویل",
  city: "شهر",
  settings: "تنظیمات",
  staff: "کارکنان",
};

function entityLink(e: AuditEntry) {
  if (!e.entityId) return null;
  if (e.entity === "order") return paths.order(e.entityId);
  if (e.entity === "product") return paths.product(e.entityId);
  if (e.entity === "distributor") return paths.distributor(e.entityId);
  if (e.entity === "retailer" || e.entity === "wallet") return paths.retailer(e.entityId);
  return null;
}

export default function AuditLogPage() {
  const { data: log, isLoading } = useAuditLog();
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("all");

  const rows = useMemo(() => {
    const q = normalizePersian(query.trim());
    return (log ?? []).filter(
      (e) =>
        (entity === "all" || e.entity === entity) && (!q || normalizePersian(`${e.action} ${e.actorName}`).includes(q)),
    );
  }, [log, query, entity]);

  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      {
        accessorKey: "at",
        header: "زمان",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-label-secondary tabular-nums">
            {formatJalaliDateTime(getValue<string>())}
          </span>
        ),
      },
      {
        accessorKey: "actorName",
        header: "کاربر",
        cell: ({ getValue }) => (
          <span className="flex items-center gap-2">
            <Avatar name={getValue<string>()} size="sm" /> {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "entity",
        header: "بخش",
        cell: ({ getValue }) => (
          <Badge variant="muted">{ENTITY_LABELS[getValue<string>()] ?? getValue<string>()}</Badge>
        ),
      },
      {
        accessorKey: "action",
        header: "عملیات",
        enableSorting: false,
        cell: ({ row }) => {
          const to = entityLink(row.original);
          return to ? (
            <Link to={to} className="hover:underline">
              {row.original.action}
            </Link>
          ) : (
            row.original.action
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader title="تنظیمات" description="پیکربندی پلتفرم، کارکنان و گزارش فعالیت" />
      <SettingsTabs />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        pageSize={30}
        dense
        toolbar={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="عملیات یا نام کاربر" />
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger size="sm" className="w-36 bg-fill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه بخش‌ها</SelectItem>
                {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </>
  );
}
