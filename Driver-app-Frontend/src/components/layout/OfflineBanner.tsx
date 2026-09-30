import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-error px-4 py-2 text-[13px] font-semibold text-white"
    >
      <WifiOff className="size-4" aria-hidden />
      اتصال اینترنت برقرار نیست. اطلاعات ممکن است به‌روز نباشد.
    </div>
  );
}
