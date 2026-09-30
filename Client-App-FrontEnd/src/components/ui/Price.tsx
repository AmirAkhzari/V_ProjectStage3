import { toFaNum } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function Price({
  value,
  original,
  size = "md",
}: {
  value: number;
  original?: number;
  size?: "sm" | "md" | "lg";
}) {
  const main = size === "lg" ? "text-[22px]" : size === "sm" ? "text-[13px]" : "text-[15px]";
  return (
    <div>
      <div className={cn("font-semibold leading-none", main)}>
        {toFaNum(value)}{" "}
        <span className="text-[10px] font-medium text-text-secondary">تومان</span>
      </div>
      {original ? (
        <div className="text-[11px] text-text-secondary line-through mt-1">{toFaNum(original)}</div>
      ) : null}
    </div>
  );
}
