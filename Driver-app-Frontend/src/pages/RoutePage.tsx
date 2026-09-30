import { Route as RouteIcon } from "lucide-react";
import LargeHeader from "@/components/layout/LargeHeader";
import NotificationBell from "@/components/NotificationBell";
import QueryError from "@/components/QueryError";
import StopRow from "@/components/StopRow";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToday } from "@/features/queries";
import { findNextStop, stopUiState } from "@/lib/deliveryStatus";
import { toFaNum } from "@/lib/format";

export default function RoutePage() {
  const { data, isLoading, error, refetch } = useToday();
  const next = data ? findNextStop(data.stops) : null;
  const active = data?.stops.filter((s) => s.status !== "cancelled") ?? [];
  const removed = data?.stops.filter((s) => s.status === "cancelled") ?? [];

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <LargeHeader
        title="مسیر امروز"
        subtitle={data ? `${toFaNum(active.length)} توقف، ترتیب را مدیر تعیین می‌کند` : undefined}
        trailing={<NotificationBell />}
      />
      <div className="px-4">
        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : active.length === 0 && removed.length === 0 ? (
          <EmptyState
            icon={<RouteIcon />}
            title="مسیری برای امروز ندارید"
            body="سفارش‌هایی که مدیر به شما بسپارد به ترتیب اینجا نمایش داده می‌شوند."
          />
        ) : (
          <>
            {active.map((s, i) => (
              <StopRow key={s.id} stop={s} state={stopUiState(s, next?.id)} timeline last={i === active.length - 1} />
            ))}
            {removed.length ? (
              <>
                <h2 className="mt-5 mb-2 px-1 text-[13px] font-semibold text-label-secondary">حذف‌شده از مسیر</h2>
                {removed.map((s) => (
                  <StopRow key={s.id} stop={s} state={stopUiState(s)} />
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
