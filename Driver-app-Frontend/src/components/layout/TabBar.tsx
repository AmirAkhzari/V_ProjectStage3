import { NavLink } from "react-router-dom";
import { History, House, Route, UserRound } from "lucide-react";

const TABS = [
  { to: "/", label: "امروز", Icon: House, end: true },
  { to: "/route", label: "مسیر", Icon: Route },
  { to: "/history", label: "تاریخچه", Icon: History },
  { to: "/profile", label: "پروفایل", Icon: UserRound },
];

export default function TabBar() {
  return (
    <nav className="relative z-10 flex shrink-0 border-t border-separator bg-card/85 pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur-xl">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className="flex-1 outline-none">
          {({ isActive }) => (
            <span
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 ${
                isActive ? "text-accent" : "text-label-secondary"
              }`}
            >
              <Icon className="size-6" strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
              <span className="text-[12px] font-medium">{label}</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
