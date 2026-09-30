// Copied from ../FrontEnd/src/components/ui/VisitorLogo.tsx
import { cn } from "@/lib/utils";

export default function VisitorLogo({
  size = "lg",
  suffix,
  className,
}: {
  size?: "sm" | "lg";
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-baseline", size === "lg" ? "gap-2.5" : "gap-1.5", className)}>
      <span className={cn("self-center rounded-full bg-primary", size === "lg" ? "size-2.5" : "size-1.5")} />
      <span className={cn("font-black tracking-tight", size === "lg" ? "text-[34px]" : "text-[19px]")}>ویزیتور</span>
      {suffix ? (
        <span className={cn("font-medium text-label-secondary", size === "lg" ? "text-[15px]" : "text-[12px]")}>
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
