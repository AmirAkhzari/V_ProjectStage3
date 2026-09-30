import { cn } from "@/lib/cn";

type Props = {
  lifting?: boolean;
  dropping?: boolean;
  label?: string;
  compact?: boolean;
};

export default function PickupPin({ lifting = false, dropping = false, label, compact = false }: Props) {
  return (
    <div className="flex flex-col items-center">
      {!compact && (
        <div
          className={cn(
            "relative mb-2 max-w-[240px] rounded-[10px] bg-card px-3 py-1.5 text-[13px] font-semibold text-text-primary shadow-[0_10px_28px_rgb(0_0_0/0.16)] transition-opacity duration-150",
            lifting && "opacity-70",
          )}
        >
          <span className="block truncate">{lifting ? "در حال انتخاب مبدأ" : label}</span>
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-8 border-transparent border-t-card" />
        </div>
      )}
      <div className="relative flex flex-col items-center">
        <svg
          className={cn(
            "relative z-10 text-accent drop-shadow-[0_6px_10px_rgb(0_0_0/0.28)] transition-transform duration-200 ease-out",
            lifting && "-translate-y-3.5",
            dropping && "uber-pin-drop",
          )}
          width={compact ? 28 : 36}
          height={compact ? 36 : 46}
          viewBox="0 0 36 46"
          aria-hidden
        >
          <path
            fill="currentColor"
            d="M18 0C8.06 0 0 8.06 0 18c0 12.5 18 28 18 28s18-15.5 18-28C36 8.06 27.94 0 18 0z"
          />
          <circle cx="18" cy="18" r="6.5" fill="var(--ios-bg-grouped-secondary)" />
        </svg>
        <span
          className={cn(
            "mt-[-3px] h-[7px] w-5 rounded-full bg-black/30 blur-[1px] transition-all duration-200",
            lifting && "w-2.5 scale-75 opacity-40",
          )}
        />
      </div>
    </div>
  );
}
