import { toFaNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Price({
  value,
  className,
  unit = true,
  signed = false,
}: {
  value: number;
  className?: string;
  unit?: boolean;
  signed?: boolean;
}) {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {sign}
      {toFaNum(Math.abs(value))}
      {unit ? <span className="mr-1 text-[0.8em] text-label-secondary">تومان</span> : null}
    </span>
  );
}
