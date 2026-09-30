import { cn } from "@/lib/utils";

export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-fill", className)} />;
}
