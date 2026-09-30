import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Ban, CheckCircle2, MapPin, Phone, Truck, Wallet } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import Price from "@/components/shared/Price";
import StatCard from "@/components/shared/StatCard";
import OrderStatusBadge from "@/components/shared/StatusBadge";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import Can from "@/components/shared/Can";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useRetailer,
  useRetailerAddresses,
  useSetRetailerStatus,
  useSetRetailerSubscription,
} from "@/features/people";
import { useOrders } from "@/features/orders";
import { useWallets } from "@/features/ops";
import { toFaNum } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatJalali, formatJalaliDateTime, relativeLabel } from "@/lib/jalali";
import { paths } from "@/routes/paths";
import AddressMap from "./components/AddressMap";
import { PlanBadge, SubscriptionStatusBadge } from "./components/PlanBadge";
import ChangePrimaryDistributorDialog from "./components/ChangePrimaryDistributorDialog";
import SubscriptionActionDialog from "./components/SubscriptionActionDialog";
import WalletAdjustDialog from "@/pages/finance/components/WalletAdjustDialog";
import type { SubscriptionAction } from "@/types";

export default function RetailerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: retailer, isLoading } = useRetailer(id);
  const { data: addresses } = useRetailerAddresses(id);
  const { data: allOrders } = useOrders();
  const { data: wallets } = useWallets();
  const setStatus = useSetRetailerStatus();
  const setSubscription = useSetRetailerSubscription();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [changingPrimary, setChangingPrimary] = useState(false);
  const [subAction, setSubAction] = useState<Extract<SubscriptionAction, "grant" | "extend"> | null>(null);

  const orders = useMemo(() => (allOrders ?? []).filter((o) => o.retailerId === id), [allOrders, id]);
  const wallet = wallets?.find((w) => w.retailerId === id);
  const stats = useMemo(() => {
    const ok = orders.filter((o) => o.status !== "cancelled");
    const spent = ok.reduce((s, o) => s + o.total, 0);
    return {
      spent,
      count: ok.length,
      avg: ok.length ? Math.round(spent / ok.length) : 0,
      cancelled: orders.length - ok.length,
    };
  }, [orders]);

  if (isLoading) return <Skeleton className="h-96" />;
  if (!retailer) {
    return (
      <EmptyState
        title="فروشگاه پیدا نشد"
        className="py-32"
        action={
          <Button asChild variant="secondary">
            <Link to={paths.retailers}>بازگشت</Link>
          </Button>
        }
      />
    );
  }

  const blocked = retailer.status === "blocked";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "فروشگاه‌ها", to: paths.retailers }, { label: retailer.name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={retailer.name} /> {retailer.name}
          </span>
        }
        badge={
          <span className="flex items-center gap-1.5">
            {blocked ? <Badge variant="danger">مسدود</Badge> : <Badge variant="neutral">فعال</Badge>}
            <PlanBadge plan={retailer.plan ?? "free"} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="ltr flex items-center gap-1">
              <Phone className="size-3.5" /> {formatPhoneDisplay(retailer.phone)}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" /> {retailer.city}
            </span>
            <span>عضو از {formatJalali(retailer.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Can perm="finance.adjust">
              <Button variant="outline" onClick={() => setAdjusting(true)}>
                <Wallet /> تعدیل کیف پول
              </Button>
            </Can>
            <Can perm="retailers.manage">
              {blocked ? (
                <Button
                  variant="secondary"
                  onClick={() => setStatus.mutate({ id: retailer.id, status: "active" })}
                  loading={setStatus.isPending}
                >
                  <CheckCircle2 /> رفع مسدودی
                </Button>
              ) : (
                <Button variant="destructive-soft" onClick={() => setConfirmBlock(true)}>
                  <Ban /> مسدود کردن
                </Button>
              )}
            </Can>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="مجموع خرید" value={<Price value={stats.spent} />} />
        <StatCard
          label="سفارش‌های موفق"
          value={toFaNum(stats.count)}
          hint={stats.cancelled ? `${toFaNum(stats.cancelled)} لغو شده` : undefined}
        />
        <StatCard label="میانگین سبد" value={<Price value={stats.avg} />} />
        <StatCard label="موجودی کیف پول" value={<Price value={retailer.walletBalance} />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4 text-label-secondary" />
                شرکت پخش اصلی
              </CardTitle>
              <CardDescription>فروشگاه رایگان فقط از این شرکت می‌تواند خرید کند</CardDescription>
            </div>
            <Can perm="retailers.manage">
              <Button variant="outline" size="sm" onClick={() => setChangingPrimary(true)}>
                تغییر
              </Button>
            </Can>
          </CardHeader>
          <CardContent>
            {retailer.primaryDistributor?.name || retailer.primaryDistributorName ? (
              <div>
                <div className="text-[15px] font-semibold">
                  {retailer.primaryDistributor?.name ?? retailer.primaryDistributorName}
                </div>
                {retailer.primaryDistributor?.id || retailer.primaryDistributorId ? (
                  <Link
                    to={paths.distributor(retailer.primaryDistributor?.id ?? retailer.primaryDistributorId!)}
                    className="mt-1 inline-block text-[12px] text-label-secondary hover:underline"
                  >
                    مشاهده شرکت پخش
                  </Link>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-label-secondary">هنوز شرکت پخش اصلی تعیین نشده</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>اشتراک پرو</CardTitle>
              <CardDescription>باز کردن بازار شهر برای خرید از همه شرکت‌های پخش</CardDescription>
            </div>
            <PlanBadge plan={retailer.plan ?? "free"} />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-[13px] text-label-secondary">
              {retailer.plan === "pro" && retailer.subscriptionExpiresAt
                ? `تا ${formatJalali(retailer.subscriptionExpiresAt)} معتبر است`
                : "پلن رایگان — فقط شرکت پخش اصلی"}
            </p>
            <Can perm="subscriptions.manage">
              <div className="flex flex-wrap gap-2">
                {retailer.plan === "pro" ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setSubAction("extend")}>
                      تمدید
                    </Button>
                    <Button variant="destructive-soft" size="sm" onClick={() => setConfirmRevoke(true)}>
                      لغو اشتراک
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setSubAction("grant")}>
                    اعطای پرو
                  </Button>
                )}
              </div>
            </Can>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="orders" className="mt-4">
        <TabsList>
          <TabsTrigger value="orders">سفارش‌ها ({toFaNum(orders.length)})</TabsTrigger>
          <TabsTrigger value="addresses">آدرس‌ها ({toFaNum(addresses?.length ?? 0)})</TabsTrigger>
          <TabsTrigger value="wallet">کیف پول</TabsTrigger>
          <TabsTrigger value="subscriptions">اشتراک‌ها ({toFaNum(retailer.subscriptions?.length ?? 0)})</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            {orders.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>شماره</TableHead>
                    <TableHead>شرکت پخش</TableHead>
                    <TableHead>اقلام</TableHead>
                    <TableHead>مبلغ</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead>زمان</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link to={paths.order(o.id)} className="ltr inline-block font-semibold hover:underline">
                          {o.number}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-44 truncate text-label-secondary">{o.distributorName}</TableCell>
                      <TableCell className="text-label-secondary">{toFaNum(o.items.length)} قلم</TableCell>
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
              <EmptyState title="این فروشگاه هنوز سفارشی نداده" />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="addresses">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <AddressMap addresses={addresses ?? []} />
            </Card>
            <div className="flex flex-col gap-3">
              {addresses?.length ? (
                addresses.map((a) => (
                  <Card key={a.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">{a.title}</span>
                      {a.tag ? (
                        <Badge variant="muted">
                          {a.tag === "store" ? "فروشگاه" : a.tag === "warehouse" ? "انبار" : "شعبه"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[12px] text-label-secondary">{a.fullAddress}</p>
                    <p className="mt-1 text-[12px] text-label-tertiary">
                      پلاک {a.plaque} · واحد {a.unit}
                    </p>
                  </Card>
                ))
              ) : (
                <EmptyState title="آدرسی ثبت نشده" />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="wallet">
          <Card>
            <CardHeader>
              <CardTitle>تراکنش‌های کیف پول</CardTitle>
              <span className="text-[13px] font-semibold">
                موجودی: <Price value={wallet?.balance ?? retailer.walletBalance} />
              </span>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border">
              {wallet?.transactions.length ? (
                wallet.transactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2.5 text-[13px] first:pt-0 last:pb-0">
                    <div>
                      <div className="font-medium">
                        {t.kind === "topup"
                          ? "افزایش اعتبار"
                          : t.kind === "order"
                            ? `پرداخت سفارش ${t.note ?? ""}`
                            : "تعدیل دستی"}
                      </div>
                      <div className="text-[12px] text-label-secondary">
                        {formatJalaliDateTime(t.createdAt)}
                        {t.kind === "adjustment" && t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                    <Price
                      value={t.amount}
                      signed
                      className={
                        t.status === "failed" ? "text-label-tertiary line-through" : t.amount < 0 ? "" : "font-semibold"
                      }
                    />
                  </div>
                ))
              ) : (
                <EmptyState title="تراکنشی وجود ندارد" className="py-8" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscriptions">
          <Card>
            {retailer.subscriptions?.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>پلن</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead>شروع</TableHead>
                    <TableHead>انقضا</TableHead>
                    <TableHead>شناسه پرداخت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {retailer.subscriptions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <PlanBadge plan={s.plan} />
                      </TableCell>
                      <TableCell>
                        <SubscriptionStatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-label-secondary">{formatJalali(s.startsAt)}</TableCell>
                      <TableCell className="text-label-secondary">{formatJalali(s.expiresAt)}</TableCell>
                      <TableCell className="ltr text-right text-[12px] text-label-tertiary">
                        {s.paymentId ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="سابقه‌ای از اشتراک ثبت نشده" />
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title="مسدود کردن فروشگاه"
        description="فروشگاه دیگر نمی‌تواند سفارش جدید ثبت کند. سفارش‌های جاری ادامه می‌یابند."
        confirmLabel="مسدود کن"
        destructive
        loading={setStatus.isPending}
        onConfirm={async () => {
          await setStatus.mutateAsync({ id: retailer.id, status: "blocked" });
          setConfirmBlock(false);
        }}
      />
      {wallet ? <WalletAdjustDialog open={adjusting} onOpenChange={setAdjusting} wallet={wallet} /> : null}
      <ChangePrimaryDistributorDialog open={changingPrimary} onOpenChange={setChangingPrimary} retailer={retailer} />
      {subAction ? (
        <SubscriptionActionDialog
          open
          onOpenChange={(v) => {
            if (!v) setSubAction(null);
          }}
          retailer={retailer}
          action={subAction}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="لغو اشتراک پرو"
        description="فروشگاه به پلن رایگان برمی‌گردد و فقط از شرکت پخش اصلی می‌تواند خرید کند."
        confirmLabel="لغو اشتراک"
        destructive
        loading={setSubscription.isPending}
        onConfirm={async () => {
          await setSubscription.mutateAsync({ id: retailer.id, action: "revoke" });
          setConfirmRevoke(false);
        }}
      />
    </>
  );
}
