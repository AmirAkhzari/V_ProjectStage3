import type { ReactNode } from "react";

/** iOS large-title header used on the tab root screens. */
export default function LargeHeader({
  title,
  subtitle,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-end justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        {subtitle ? <div className="text-[13px] font-medium text-label-secondary">{subtitle}</div> : null}
        <h1 className="truncate text-[28px] leading-9 font-extrabold">{title}</h1>
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
    </header>
  );
}
