import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export default function BackHeader({
  title,
  onBack,
  trailing,
}: {
  title?: string;
  onBack?: () => void;
  trailing?: ReactNode;
}) {
  const navigate = useNavigate();
  const back = onBack ?? (() => (window.history.length > 1 ? navigate(-1) : navigate("/")));
  return (
    <div className="relative flex shrink-0 items-center justify-between border-b border-separator bg-page/85 px-2 py-1.5 backdrop-blur-xl">
      <button type="button" onClick={back} className="flex h-11 items-center px-1 text-accent" aria-label="بازگشت">
        <ChevronRight className="size-7" strokeWidth={2.2} />
        <span className="text-[17px]">بازگشت</span>
      </button>
      <span className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold">
        {title}
      </span>
      <div className="flex min-w-16 justify-end">{trailing}</div>
    </div>
  );
}
