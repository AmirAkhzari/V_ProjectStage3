import { Check, X } from "lucide-react";
import { ORDER_STATUS_LABELS } from "@/lib/orderStatus";
import { formatJalaliDateTime } from "@/lib/jalali";
import type { OrderEvent, OrderStatus } from "@/types";
import { cn } from "@/lib/utils";

export default function OrderTimeline({ events, current }: { events: OrderEvent[]; current: OrderStatus }) {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <ol className="relative flex flex-col gap-0">
      {sorted.map((event, i) => {
        const last = i === sorted.length - 1;
        const cancelled = event.status === "cancelled";
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? <span className="absolute top-6 right-[9px] bottom-0 w-px bg-border" aria-hidden /> : null}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                cancelled
                  ? "bg-destructive text-white"
                  : last && current === event.status
                    ? "bg-primary text-primary-foreground"
                    : "bg-fill text-foreground",
              )}
            >
              {cancelled ? <X className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className={cn("text-[13px] font-semibold", cancelled && "text-destructive")}>
                  {ORDER_STATUS_LABELS[event.status]}
                </span>
                <span className="text-[12px] text-label-secondary tabular-nums">{formatJalaliDateTime(event.at)}</span>
              </div>
              <div className="text-[12px] text-label-secondary">
                {event.actorName}
                {event.note ? <span> · {event.note}</span> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
