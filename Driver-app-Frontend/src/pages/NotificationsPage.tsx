import { useNavigate } from "react-router-dom";
import { Ban, Bell, BellOff, Check, Info, Route, TriangleAlert, Truck, UserX } from "lucide-react";
import BackHeader from "@/components/layout/BackHeader";
import QueryError from "@/components/QueryError";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useMarkNotificationsRead, useNotifications } from "@/features/queries";
import { relativeLabel } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import type { NotificationKind } from "@/types";

const ICONS: Record<NotificationKind, typeof Bell> = {
  task_assigned: Truck,
  route_updated: Route,
  assignment_removed: UserX,
  order_cancelled: Ban,
  delivery_confirmed: Check,
  delivery_rejected: TriangleAlert,
  instruction: Info,
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <>
      <BackHeader
        title="اعلان‌ها"
        trailing={
          unread ? (
            <button
              type="button"
              onClick={() => markRead.mutate(undefined)}
              className="h-11 px-2 text-[14px] font-semibold text-accent"
            >
              خواندن همه
            </button>
          ) : null
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : !data?.length ? (
          <EmptyState
            icon={<BellOff />}
            title="اعلانی ندارید"
            body="تخصیص سفارش جدید و تغییرات مسیر اینجا اطلاع داده می‌شود."
          />
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-card">
            {data.map((n) => {
              const Icon = ICONS[n.kind];
              const danger = n.kind === "delivery_rejected" || n.kind === "order_cancelled";
              return (
                <li key={n.id} className="border-b border-separator last:border-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate([n.id]);
                      if (n.deliveryId) navigate(`/tasks/${n.deliveryId}`);
                    }}
                    className="flex w-full items-start gap-3 p-4 text-right"
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        danger ? "bg-error/12 text-error" : "bg-fill",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("text-[15px]", n.readAt ? "font-medium" : "font-bold")}>{n.title}</span>
                        <span className="shrink-0 text-[12px] text-label-secondary">{relativeLabel(n.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-6 text-label-secondary">{n.body}</span>
                    </span>
                    {!n.readAt ? (
                      <span className="mt-2 size-2.5 shrink-0 rounded-full bg-error" aria-label="خوانده‌نشده" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
