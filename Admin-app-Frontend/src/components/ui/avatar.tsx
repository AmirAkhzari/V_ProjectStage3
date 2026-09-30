import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

export function Avatar({
  name,
  className,
  size = "md",
}: {
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-14 text-[18px]" : "size-9 text-[13px]";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        dims,
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
