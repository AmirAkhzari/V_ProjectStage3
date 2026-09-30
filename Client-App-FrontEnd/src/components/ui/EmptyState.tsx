import type { ReactNode } from "react";

export default function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-10 py-16">
      <div className="mb-5">{icon}</div>
      <div className="text-[17px] font-extrabold mb-2">{title}</div>
      {body ? <p className="text-[13px] text-text-secondary leading-7 max-w-[260px]">{body}</p> : null}
    </div>
  );
}
