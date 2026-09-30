import { IconMinus, IconPlus } from "@/components/icons";
import { toFaNum } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function QtyControl({
  count,
  onAdd,
  onSub,
  compact = false,
}: {
  count: number;
  onAdd: () => void;
  onSub: () => void;
  compact?: boolean;
}) {
  if (count === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          "w-full rounded-[10px] bg-fill text-accent font-semibold flex items-center justify-center gap-1 min-h-11",
          compact ? "text-xs" : "text-[13px]",
        )}
      >
        <IconPlus size={compact ? 14 : 15} /> افزودن کارتن
      </button>
    );
  }
  return (
    <div className="w-full min-h-11 rounded-[10px] bg-accent text-inverse flex items-center justify-between px-1">
      <button type="button" onClick={onAdd} className="size-11 rounded-lg bg-inverse/15 flex items-center justify-center" aria-label="افزایش کارتن">
        <IconPlus size={14} />
      </button>
      <span className="font-semibold text-sm">{toFaNum(count)}</span>
      <button type="button" onClick={onSub} className="size-11 rounded-lg bg-inverse/15 flex items-center justify-center" aria-label="کاهش کارتن">
        <IconMinus />
      </button>
    </div>
  );
}
