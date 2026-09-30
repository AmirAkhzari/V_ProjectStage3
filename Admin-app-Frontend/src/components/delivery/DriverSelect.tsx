import { Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssignDriver } from "@/features/drivers";
import { assignmentLockReason, isActiveDelivery } from "@/lib/deliveryStatus";
import { useCan } from "@/store/useSessionStore";
import { cn } from "@/lib/utils";
import type { DriverListItem, Order } from "@/types";

const NONE = "__none__";

/**
 * Validated driver picker: only active drivers of the order's own distributor are offered.
 * The API re-checks tenant, activity and order state, so this is a convenience, not the guard.
 */
export default function DriverSelect({
  order,
  drivers,
  size = "sm",
  className,
}: {
  order: Order;
  drivers: DriverListItem[];
  size?: "sm" | "md";
  className?: string;
}) {
  const canAssign = useCan("deliveries.assign");
  const assign = useAssignDriver();
  const active = isActiveDelivery(order.delivery) ? order.delivery : null;
  const lock = assignmentLockReason(order.status, order.delivery);
  const options = drivers.filter((d) => d.distributorId === order.distributorId && d.active);
  const current = active?.driverId ?? NONE;

  if (lock || !canAssign) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex h-8 max-w-44 items-center gap-1.5 truncate rounded-lg px-2 text-[12px]",
              active ? "font-medium" : "text-label-tertiary",
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {lock ? <Lock className="size-3 shrink-0 text-label-tertiary" /> : null}
            <span className="truncate">{active?.driverName ?? order.delivery?.driverName ?? "—"}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{lock ?? "دسترسی تعیین راننده ندارید"}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className={className}>
      <Select
        value={current}
        disabled={assign.isPending}
        onValueChange={(v) => assign.mutate({ orderId: order.id, driverId: v === NONE ? null : v })}
      >
        <SelectTrigger
          size={size}
          aria-label="راننده"
          className={cn("w-40 bg-fill", current === NONE && "text-label-secondary", size === "md" && "w-full")}
        >
          <SelectValue placeholder="انتخاب راننده" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{active ? "برداشتن راننده" : "بدون راننده"}</SelectItem>
          {options.map((d) => (
            <SelectItem key={d.id} value={d.id} hint={`${d.today.remaining.toLocaleString("fa-IR")} توقف باز امروز`}>
              {d.name}
            </SelectItem>
          ))}
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-[12px] text-label-secondary">راننده فعالی برای این شرکت پخش نیست</div>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
