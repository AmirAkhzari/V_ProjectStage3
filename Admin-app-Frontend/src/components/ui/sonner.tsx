import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useUiStore } from "@/store/useUiStore";

export function Toaster(props: ToasterProps) {
  const theme = useUiStore((s) => s.theme);
  return (
    <Sonner
      theme={theme}
      position="top-center"
      dir="rtl"
      duration={3000}
      toastOptions={{
        classNames: {
          toast: "!bg-primary !text-primary-foreground !border-0 !rounded-xl !text-[13px] !font-medium !shadow-none",
          description: "!text-primary-foreground/70",
          error: "!bg-destructive !text-white",
          actionButton: "!bg-primary-foreground !text-primary",
        },
      }}
      {...props}
    />
  );
}
