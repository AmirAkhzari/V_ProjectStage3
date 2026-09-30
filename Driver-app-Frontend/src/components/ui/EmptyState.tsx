import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export default function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-fill text-label-secondary [&_svg]:size-7">
        {icon}
      </div>
      <div className="text-[17px] font-semibold">{title}</div>
      {body ? <p className="mt-1.5 max-w-xs text-[14px] leading-6 text-label-secondary">{body}</p> : null}
      {action ? <div className="mt-5 w-full max-w-xs">{action}</div> : null}
    </div>
  );
}
