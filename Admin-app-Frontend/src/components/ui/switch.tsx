import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full bg-fill-secondary transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:-translate-x-[18px] data-[state=unchecked]:-translate-x-[2px] dark:data-[state=checked]:bg-black dark:data-[state=unchecked]:bg-[#AEAEB2]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
