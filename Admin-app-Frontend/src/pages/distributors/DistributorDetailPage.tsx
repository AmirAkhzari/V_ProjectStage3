import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Boxes, Clock, MapPin, Pencil, Phone, Star, Users } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import StatCard from "@/components/shared/StatCard";
import OrderStatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import Can from "@/components/shared/Can";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDistributor } from "@/features/catalog";
import { useOrders } from "@/features/orders";
import { useStaff } from "@/features/people";
import { formatMultiplier, toFaDigits, toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { relativeLabel } from "@/lib/jalali";
import { paths } from "@/routes/paths";
import DistributorFormDialog from "./components/DistributorFormDialog";

export default function DistributorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: distributor, isLoading } = useDistributor(id);
  const { data: orders } = useOrders({ distributorId: id });
  const { data: staff } = useStaff();
  const [editing, setEditing] = useState(false);

  const stats = useMemo(() => {
    const list = (orders ?? []).filter((o) => o.status !== "cancelled");
    const gmv = list.reduce((s, o) => s + o.total, 0);
    return {
      gmv,
      orders: list.length,
      retailers: new Set(list.map((o) => o.retailerId)).size,
      avg: list.length ? Math.round(gmv / list.length) : 0,
    };
  }, [orders]);

  if (isLoading) return <Skeleton className="h-96" />;
  if (!distributor) {
    return (
      <EmptyState
        title="شرکت پخش پیدا نشد"
        className="py-32"
        action={
          <Button asChild variant="secondary">
            <Link to={paths.distributors}>بازگشت</Link>
          </Button>
        }
      />
    );
  }

  const team = (staff ?? []).filter((s) => s.distributorId === distributor.id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "شرکت‌های پخش", to: paths.distributors }, { label: distributor.name }]}
        title={distributor.name}
        badge={
          distributor.status === "active" ? (
            <Badge variant="neutral">فعال</Badge>
          ) : (
            <Badge variant="muted">ظرفیت پر</Badge>
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" /> {distributor.cities.join("، ")}
            </span>
            <span className="flex items-center gap-1">
              <Star className="size-3.5" /> {toFaDigits(distributor.rating.toFixed(1))}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" /> {toFaNum(distributor.deliveryMins)} دقیقه
            </span>
            {distributor.phone ? (
              <span className="ltr flex items-center gap-1">
                <Phone className="size-3.5" /> {formatPhoneDisplay(distributor.phone)}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={paths.stock}>
                <Boxes /> موجودی
              </Link>
            </Button>
            <Can perm="distributors.manage">
              <Button onClick={() => setEditing(true)}>
                <Pencil /> ویرایش
              </Button>
            </Can>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="فروش" value={<Price value={stats.gmv} />} hint="۳۰ روز اخیر" />
        <StatCard label="سفارش‌ها" value={toFaNum(stats.orders)} hint="تکمیل‌شده یا جاری" />
        <StatCard label="فروشگاه‌های فعال" value={toFaNum(stats.retailers)} />
        <StatCard
          label="ضریب قیمت"
          value={formatMultiplier(distributor.priceMultiplier)}
          hint={distributor.deliveryFee === "free" ? "ارسال رایگان" : `ارسال ${toFaNum(distributor.deliveryFee)} تومان`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>سفارش‌های اخیر</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to={`${paths.orders}?distributor=${distributor.id}`}>مشاهده همه</Link>
            </Button>
          </CardHeader>
          {orders?.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>شماره</TableHead>
                  <TableHead>فروشگاه</TableHead>
                  <TableHead>مبلغ</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>زمان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.slice(0, 8).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link to={paths.order(o.id)} className="ltr inline-block font-semibold hover:underline">
                        {o.number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-44 truncate">{o.retailerName}</TableCell>
                    <TableCell>
                      <Price value={o.total} />
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-label-secondary">{relativeLabel(o.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="هنوز سفارشی ثبت نشده" />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-label-secondary" /> تیم
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {team.length ? (
              team.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5 text-[13px] first:pt-0 last:pb-0">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[12px] text-label-secondary">{s.roleLabel}</div>
                  </div>
                  <Badge variant={s.active ? "neutral" : "muted"}>{s.active ? "فعال" : "غیرفعال"}</Badge>
                </div>
              ))
            ) : (
              <EmptyState title="کاربری تعریف نشده" className="py-6" />
            )}
          </CardContent>
        </Card>
      </div>

      <DistributorFormDialog open={editing} onOpenChange={setEditing} distributor={distributor} />
    </>
  );
}
