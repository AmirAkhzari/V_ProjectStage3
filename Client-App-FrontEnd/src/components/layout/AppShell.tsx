import type { ReactNode } from "react";
import ToastHost from "@/components/ui/ToastHost";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame bg-page flex justify-center">
      <div className="app-frame w-full max-w-lg bg-page text-text-primary flex flex-col relative pt-[env(safe-area-inset-top)]">
        <ToastHost />
        {children}
      </div>
    </div>
  );
}
