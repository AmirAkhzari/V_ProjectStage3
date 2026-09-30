import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardList, ShoppingBasket, Store, Wallet } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import Price from "@/components/shared/Price";
import OrderStatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDashboard } from "@/features/orders";
import { useSessionStore } from "@/store/useSessionStore";
import { formatCompactToman, toFaNum } from "@/lib/format";
import { formatJalaliShort, relativeLabel } from "@/lib/jalali";
import { paths } from "@/routes/paths";
import OrdersTrendChart from "./components/OrdersTrendChart";
import StatusDonut from "./components/StatusDonut";

function delta(cur: number, prev: number) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const staff = useSessionStore((s) => s.session?.staff);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صبح بخیر" : hour < 17 ? "ظهر بخیر" : "عصر بخیر";

  return (
    <>
      <PageHeader
        title={`${greeting}، ${staff?.name.split(" ")[0] ?? ""}`}
        description={`${formatJalaliShort(new Date())} · نمای کلی عملکرد امروز`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="فروش امروز"
          value={data ? <Price value={data.gmvToday} /> : null}
          delta={data ? delta(data.gmvToday, data.gmvYesterday) : null}
          hint="نسبت به دیروز"
          icon={<Wallet />}
          loading={isLoading}
        />
        <StatCard
          label="سفارش‌های در انتظار"
          value={data ? toFaNum(data.pendingOrders) : null}
          hint="نیاز به تایید"
          icon={<ClipboardList />}
          loading={isLoading}
        />
        <StatCard
          label="فروشگاه‌های فعال"
          value={data ? toFaNum(data.activeRetailers) : null}
          hint="در ۳۰ روز گذشته"
          icon={<Store />}
          loading={isLoading}
        />
        <StatCard
          label="میانگین سبد"
          value={data ? <Price value={data.avgBasket} /> : null}
          delta={data ? delta(data.avgBasket, data.avgBasketPrev) : null}
          hint="۷ روز اخیر"
          icon={<ShoppingBasket />}
          loading={isLoading}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>روند سفارش‌ها</CardTitle>
              <CardDescription>
                ۳۰ روز گذشته · فروش {data ? formatCompactToman(data.gmv30d) : "—"} تومان
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            {isLoading || !data ? <Skeleton className="h-full w-full" /> : <OrdersTrendChart data={data.trend} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>وضعیت سفارش‌ها</CardTitle>
              <CardDescription>همه سفارش‌های ثبت‌شده</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            {isLoading || !data ? <Skeleton className="h-full w-full" /> : <StatusDonut data={data.ordersByStatus} />}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>شرکت‌های پخش برتر</CardTitle>
              <CardDescription>بر اساس فروش ۳۰ روز</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isLoading || !data ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)
            ) : data.topDistributors.length === 0 ? (
              <EmptyState title="داده‌ای برای نمایش نیست" className="py-8" />
            ) : (
              data.topDistributors.map((d, i) => {
                const max = data.topDistributors[0].gmv || 1;
                return (
                  <Link
                    key={d.id}
                    to={paths.distributor(d.id)}
                    className="group grid grid-cols-[1.25rem_1fr_auto] items-center gap-3"
                  >
                    <span className="text-[12px] text-label-tertiary tabular-nums">{toFaNum(i + 1)}</span>
                    <span className="min-w-0">
                      <span className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="truncate font-medium group-hover:underline">{d.name}</span>
                        <span className="text-label-secondary">{d.city}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fill">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(6, (d.gmv / max) * 100)}%`,
                          }}
                        />
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums">{formatCompactToman(d.gmv)}</span>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>هشدار کمبود موجودی</CardTitle>
              <CardDescription>کمتر از ۵ کارتن باقی‌مانده</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to={paths.stock}>مدیریت موجودی</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {isLoading || !data ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-9" />)
            ) : data.lowStock.length === 0 ? (
              <EmptyState title="موجودی همه کالاها کافی است" className="py-8" />
            ) : (
              data.lowStock.map((s) => (
                <div
                  key={`${s.distributorId}:${s.productId}`}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive">
                    <AlertTriangle className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{s.productName}</span>
                    <span className="block truncate text-[12px] text-label-secondary">{s.distributorName}</span>
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {toFaNum(s.cartonsLeft)} <span className="text-[11px] font-normal text-label-secondary">کارتن</span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>آخرین سفارش‌ها</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to={paths.orders}>مشاهده همه</Link>
          </Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>شماره</TableHead>
              <TableHead>فروشگاه</TableHead>
              <TableHead className="hidden md:table-cell">شرکت پخش</TableHead>
              <TableHead className="hidden sm:table-cell">اقلام</TableHead>
              <TableHead>مبلغ</TableHead>
              <TableHead>وضعیت</TableHead>
              <TableHead className="hidden lg:table-cell">زمان</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || !data
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data.recentOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link to={paths.order(o.id)} className="ltr inline-block font-semibold hover:underline">
                        {o.number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">{o.retailerName}</TableCell>
                    <TableCell className="hidden max-w-44 truncate text-label-secondary md:table-cell">
                      {o.distributorName}
                    </TableCell>
                    <TableCell className="hidden text-label-secondary sm:table-cell">
                      {toFaNum(o.items.length)} قلم · {toFaNum(o.items.reduce((s, i) => s + i.qty, 0))} کارتن
                    </TableCell>
                    <TableCell>
                      <Price value={o.total} />
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="hidden text-label-secondary lg:table-cell">
                      {relativeLabel(o.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
