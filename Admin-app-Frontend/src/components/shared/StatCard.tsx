import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function StatCard({
  label,
  value,
  hint,
  delta,
  icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number | null;
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-medium text-label-secondary">{label}</span>
        {icon ? <span className="text-label-tertiary [&_svg]:size-4">{icon}</span> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-32" />
      ) : (
        <div className="mt-2 text-[28px] leading-9 font-bold tabular-nums">{value}</div>
      )}
      <div className={cn("mt-1 flex items-center gap-1.5 text-[12px] text-label-secondary", loading && "invisible")}>
        {delta != null && Number.isFinite(delta) ? (
          <span className="font-semibold text-foreground">
            {delta >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(delta))}
          </span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
    </Card>
  );
}
