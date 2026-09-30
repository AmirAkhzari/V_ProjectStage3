import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-14 text-center", className)}>
      <span className="text-label-tertiary [&_svg]:size-8 [&_svg]:stroke-[1.5]">{icon ?? <Inbox />}</span>
      <p className="text-[14px] font-medium">{title}</p>
      {description ? <p className="max-w-xs text-[12px] text-label-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
