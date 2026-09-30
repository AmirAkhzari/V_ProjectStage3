import type { ReactNode } from "react";
import OfflineBanner from "./OfflineBanner";

/** Phone-width frame, same as the client PWA; centred on tablets/desktop. */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame flex justify-center bg-page">
      <div className="app-frame relative flex w-full max-w-lg flex-col bg-page pt-[env(safe-area-inset-top)] text-foreground">
        <OfflineBanner />
        {children}
      </div>
    </div>
  );
}
