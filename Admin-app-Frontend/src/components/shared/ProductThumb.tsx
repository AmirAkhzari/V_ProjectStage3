import { cn } from "@/lib/utils";

export default function ProductThumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white",
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt} className="size-full object-contain p-1" loading="lazy" />
      ) : (
        <span className="text-[10px] text-label-tertiary">بدون تصویر</span>
      )}
    </span>
  );
}
