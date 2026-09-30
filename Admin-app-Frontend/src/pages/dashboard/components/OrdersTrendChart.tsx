import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactToman, toFaNum } from "@/lib/format";
import { formatJalaliShort } from "@/lib/jalali";
import type { DashboardStats } from "@/types";

type Point = DashboardStats["trend"][number];

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg bg-primary px-3 py-2 text-[12px] text-primary-foreground shadow-none" dir="rtl">
      <div className="font-semibold">{formatJalaliShort(p.date)}</div>
      <div className="mt-1 opacity-80">
        {toFaNum(p.orders)} سفارش · {formatCompactToman(p.gmv)} تومان
      </div>
    </div>
  );
}

export default function OrdersTrendChart({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="gmvFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-5)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-chart-5)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => formatJalaliShort(v)}
          tick={{
            fontSize: 11,
            fill: "var(--color-label-secondary)",
            fontFamily: "inherit",
          }}
          axisLine={false}
          tickLine={false}
          interval={4}
          reversed
        />
        <YAxis
          orientation="right"
          tickFormatter={(v: number) => formatCompactToman(v)}
          tick={{
            fontSize: 11,
            fill: "var(--color-label-secondary)",
            fontFamily: "inherit",
          }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--color-label-tertiary)" }} />
        <Area
          type="monotone"
          dataKey="gmv"
          stroke="var(--color-chart-5)"
          strokeWidth={2}
          fill="url(#gmvFill)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--color-chart-5)", strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
