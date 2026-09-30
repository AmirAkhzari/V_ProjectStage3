import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/orderStatus";
import { toFaNum } from "@/lib/format";
import type { OrderStatus } from "@/types";

const COLORS: Record<OrderStatus, string> = {
  pending: "var(--color-chart-5)",
  confirmed: "var(--color-chart-4)",
  packing: "var(--color-chart-3)",
  shipped: "var(--color-chart-2)",
  delivered: "var(--color-chart-1)",
  cancelled: "var(--color-destructive)",
};

export default function StatusDonut({ data }: { data: Record<OrderStatus, number> }) {
  const rows = ORDER_STATUSES.map((status) => ({
    status,
    value: data[status],
  })).filter((r) => r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="flex h-full flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative h-44 w-full sm:h-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="status"
              innerRadius="66%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.status} fill={COLORS[r.status]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[24px] leading-7 font-bold tabular-nums">{toFaNum(total)}</span>
          <span className="text-[11px] text-label-secondary">سفارش</span>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-1.5 text-[12px]">
        {ORDER_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: COLORS[status] }} />
            <span className="flex-1 text-label-secondary">{ORDER_STATUS_LABELS[status]}</span>
            <span className="font-semibold tabular-nums">{toFaNum(data[status])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
