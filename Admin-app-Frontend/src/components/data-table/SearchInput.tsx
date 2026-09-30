import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function SearchInput({
  value,
  onChange,
  placeholder = "جستجو…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-label-tertiary" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-lg pr-9 pl-8 text-[13px]"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 left-2 -translate-y-1/2 rounded p-0.5 text-label-secondary hover:bg-fill"
          aria-label="پاک کردن"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
