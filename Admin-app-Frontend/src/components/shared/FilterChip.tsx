import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FilterChip({
  label,
  active,
  onClick,
  onClear,
  count,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  onClear?: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-fill text-foreground hover:bg-fill-secondary",
      )}
    >
      {label}
      {count != null ? (
        <span className={cn("tabular-nums", active ? "text-primary-foreground/70" : "text-label-secondary")}>
          {count.toLocaleString("fa-IR")}
        </span>
      ) : null}
      {onClear && active ? (
        <span
          role="button"
          aria-label="حذف فیلتر"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="-ml-1 rounded-full p-0.5 hover:bg-white/20"
        >
          <X className="size-3" />
        </span>
      ) : null}
    </button>
  );
}
