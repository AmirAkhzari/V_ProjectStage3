import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useUnreadCount } from "@/features/queries";
import { toFaNum } from "@/lib/format";

export default function NotificationBell() {
  const unread = useUnreadCount();
  return (
    <Link
      to="/notifications"
      aria-label={unread ? `اعلان‌ها، ${toFaNum(unread)} خوانده‌نشده` : "اعلان‌ها"}
      className="relative flex size-11 items-center justify-center rounded-full bg-card"
    >
      <Bell className="size-[22px]" aria-hidden />
      {unread > 0 ? (
        <span className="absolute -top-0.5 -left-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold text-white">
          {toFaNum(unread)}
        </span>
      ) : null}
    </Link>
  );
}
