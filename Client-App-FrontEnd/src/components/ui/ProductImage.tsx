import { useState } from "react";
import { cn } from "@/lib/cn";

export default function ProductImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={cn("bg-brand-tint flex items-center justify-center text-secondary font-black", className)}>
        {alt.slice(0, 1)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("bg-brand-tint object-contain", className)}
    />
  );
}
