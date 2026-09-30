import { NavLink } from "react-router-dom";
import { paths } from "@/routes/paths";
import { useCan } from "@/store/useSessionStore";
import { cn } from "@/lib/utils";

export default function SettingsTabs() {
  const canStaff = useCan("staff.manage");
  const canAudit = useCan("audit.view");
  const canSettings = useCan("settings.manage");
  const tabs = [
    canSettings && { to: paths.settings, label: "عمومی" },
    canStaff && { to: paths.staff, label: "کارکنان" },
    canAudit && { to: paths.audit, label: "گزارش فعالیت" },
  ].filter(Boolean) as { to: string; label: string }[];
  return (
    <nav className="mb-5 inline-flex h-9 items-center gap-1 rounded-xl bg-fill p-1">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "inline-flex h-7 items-center rounded-lg px-3 text-[12px] font-semibold text-label-secondary transition-colors",
              isActive && "bg-card text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
