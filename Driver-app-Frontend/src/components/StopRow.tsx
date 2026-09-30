import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import StatusPill from "@/components/ui/StatusPill";
import type { StopUiState } from "@/lib/deliveryStatus";
import { toFaNum } from "@/lib/format";
import { slotLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { DriverStop } from "@/types";

/** Route/list row. The sequence bubble doubles as the route line in timeline mode. */
export default function StopRow({
  stop,
  state,
  timeline,
  last,
  meta,
}: {
  stop: DriverStop;
  state: StopUiState;
  timeline?: boolean;
  last?: boolean;
  meta?: string;
}) {
  const closed = state === "cancelled" || state === "reassigned";
  const emphasized = state === "next";
  return (
    <Link to={`/tasks/${stop.id}`} className="flex items-stretch gap-3 text-right">
      {timeline ? (
        <div className="flex w-9 shrink-0 flex-col items-center">
          <span
            className={cn(
              "mt-3.5 flex size-9 items-center justify-center rounded-full text-[15px] font-bold",
              emphasized ? "bg-accent text-inverse" : state === "done" ? "bg-fill text-label-secondary" : "bg-card",
              closed && "text-label-tertiary",
            )}
          >
            {toFaNum(stop.sequence)}
          </span>
          {last ? null : <span className="w-0.5 flex-1 bg-fill-secondary" />}
        </div>
      ) : null}
      <div
        className={cn(
          "mb-2.5 flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-card p-4",
          emphasized && "ring-2 ring-accent",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("truncate text-[16px] font-semibold", closed && "text-label-secondary line-through")}>
              {stop.shop.name}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-label-secondary">
            {meta ?? `${stop.shop.city}، ساعت ${slotLabel(stop.deliverySlot)}، ${toFaNum(stop.cartons)} کارتن`}
          </div>
          <div className="mt-2">
            <StatusPill state={state} />
          </div>
        </div>
        <ChevronLeft className="size-5 shrink-0 text-label-tertiary" aria-hidden />
      </div>
    </Link>
  );
}
