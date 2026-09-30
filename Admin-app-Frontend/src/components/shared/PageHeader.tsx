import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type Crumb = { label: string; to?: string };

export default function PageHeader({
  title,
  description,
  actions,
  crumbs,
  className,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  className?: string;
  badge?: ReactNode;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {crumbs?.length ? (
          <nav className="mb-2 flex items-center gap-1 text-[12px] text-label-secondary">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.to ? (
                  <Link to={c.to} className="hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                {i < crumbs.length - 1 ? <ChevronLeft className="size-3.5" /> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="flex items-center gap-3">
          <h1 className="truncate text-[22px] leading-8 font-semibold">{title}</h1>
          {badge}
        </div>
        {description ? <p className="mt-1 text-[13px] text-label-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
