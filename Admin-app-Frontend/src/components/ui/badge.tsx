import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] leading-5 font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-fill text-foreground",
        solid: "bg-primary text-primary-foreground",
        muted: "bg-fill text-label-secondary",
        danger: "bg-destructive/12 text-destructive",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
