import { Ban, Check, Clock, Hourglass, Navigation, Package, TriangleAlert, UserX } from "lucide-react";
import { STOP_STATE_META, type PillTone, type StopUiState } from "@/lib/deliveryStatus";
import { cn } from "@/lib/utils";

const TONES: Record<PillTone, string> = {
  solid: "bg-accent text-inverse",
  neutral: "bg-fill text-accent",
  muted: "bg-fill text-label-secondary",
  danger: "bg-error/12 text-error",
};

const ICONS: Record<StopUiState, typeof Check> = {
  next: Navigation,
  ready: Package,
  not_dispatched: Clock,
  awaiting: Hourglass,
  done: Check,
  rejected: TriangleAlert,
  cancelled: Ban,
  reassigned: UserX,
};

export default function StatusPill({ state, className }: { state: StopUiState; className?: string }) {
  const meta = STOP_STATE_META[state];
  const Icon = ICONS[state];
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap",
        TONES[meta.tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
