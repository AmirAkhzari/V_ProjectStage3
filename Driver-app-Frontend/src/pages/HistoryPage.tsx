import { useMemo, useState } from "react";
import { History } from "lucide-react";
import LargeHeader from "@/components/layout/LargeHeader";
import QueryError from "@/components/QueryError";
import StopRow from "@/components/StopRow";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useHistory } from "@/features/queries";
import { HISTORY_FILTERS, stopUiState } from "@/lib/deliveryStatus";
import { dayKey, dayLabel } from "@/lib/dates";
import { formatTime } from "@/lib/jalali";
import { toFaNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DriverStop, HistoryFilter } from "@/types";

export default function HistoryPage() {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const { data, isLoading, error, refetch } = useHistory(filter);

  const groups = useMemo(() => {
    const map = new Map<string, DriverStop[]>();
    for (const s of data ?? []) {
      const k = dayKey(s.deliveryDate);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <LargeHeader title="تاریخچه تحویل" />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold",
              filter === f.id ? "bg-accent text-inverse" : "bg-card text-label-secondary",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="px-4">
        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<History />}
            title="موردی پیدا نشد"
            body={
              filter === "all"
                ? "تحویل‌هایی که کد آن‌ها را ثبت کنید اینجا نمایش داده می‌شوند."
                : "در این دسته تحویلی وجود ندارد."
            }
          />
        ) : (
          groups.map(([k, stops]) => (
            <section key={k} className="mb-4">
              <h2 className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-[15px] font-bold">{dayLabel(k)}</span>
                <span className="text-[12px] text-label-secondary">{toFaNum(stops.length)} مورد</span>
              </h2>
              {stops.map((s) => (
                <StopRow key={s.id} stop={s} state={stopUiState(s)} meta={historyMeta(s)} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function historyMeta(s: DriverStop) {
  const at = s.confirmedAt ?? s.rejectedAt ?? s.submittedAt;
  return `\u2066${s.orderNumber}\u2069، ${toFaNum(s.cartons)} کارتن${at ? `، ${formatTime(at)}` : ""}`;
}
