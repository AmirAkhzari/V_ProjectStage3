import { useNavigate } from "react-router-dom";
import { IconChevronRight } from "@/components/icons";
import { goBack } from "@/lib/navigation";

export default function BackHeader({ title, onBack }: { title?: string; onBack?: () => void }) {
  const navigate = useNavigate();
  return (
    <div dir="rtl" className="relative flex items-center justify-between px-2 py-2 bg-page/80 backdrop-blur-xl border-b border-separator shrink-0">
      <button
        type="button"
        onClick={onBack ?? (() => goBack(navigate))}
        className="h-11 px-2 flex items-center justify-center text-accent"
        aria-label="بازگشت"
      >
        <IconChevronRight />
        <span className="text-[17px] font-normal">بازگشت</span>
      </button>
      <span className="absolute inset-x-16 text-center text-[17px] font-semibold pointer-events-none">{title}</span>
      <div className="w-16" />
    </div>
  );
}
