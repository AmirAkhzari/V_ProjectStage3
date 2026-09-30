import { NavLink, useNavigate } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, LogOut, RotateCcw } from "lucide-react";
import VisitorLogo from "@/components/shared/VisitorLogo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV } from "@/routes/nav";
import { paths } from "@/routes/paths";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import { hasPermission } from "@/lib/permissions";
import { toFaNum } from "@/lib/format";
import { useDashboard } from "@/features/orders";
import { useDeliveries } from "@/features/drivers";
import { api } from "@/services/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Sidebar({ onNavigate, forceExpanded }: { onNavigate?: () => void; forceExpanded?: boolean }) {
  const session = useSessionStore((s) => s.session);
  const logout = useSessionStore((s) => s.logout);
  const collapsed = useUiStore((s) => s.sidebarCollapsed) && !forceExpanded;
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: dash } = useDashboard();
  const { data: awaiting } = useDeliveries({ status: "awaiting_confirmation" }, { poll: true });
  const badges = { pendingOrders: dash?.pendingOrders ?? 0, awaitingDeliveries: awaiting?.length ?? 0 };

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => hasPermission(session?.permissions, i.perm)),
  })).filter((g) => g.items.length);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-[264px]",
      )}
    >
      <div
        className={cn("flex h-14 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}
      >
        {collapsed ? (
          <span className="size-2.5 rounded-full bg-primary" />
        ) : (
          <VisitorLogo size="sm" suffix="پنل مدیریت" />
        )}
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.label && !collapsed ? (
              <div className="px-3 pb-1.5 text-[11px] font-semibold text-label-tertiary">{group.label}</div>
            ) : null}
            {group.label && collapsed ? <div className="mx-3 mb-2 h-px bg-sidebar-border" /> : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const link = (
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium text-label-secondary transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        isActive &&
                          "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
                        collapsed && "justify-center px-0",
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.badge && badges[item.badge] > 0 ? (
                      <span className="rounded-full bg-destructive px-1.5 py-px text-[10px] font-bold text-white tabular-nums">
                        {toFaNum(badges[item.badge])}
                      </span>
                    ) : null}
                  </NavLink>
                );
                return (
                  <li key={item.to}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="left">{item.label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-sidebar-border p-2", collapsed && "flex flex-col items-center gap-1")}>
        {session ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg p-2 text-right hover:bg-sidebar-accent",
                  collapsed && "justify-center",
                )}
              >
                <Avatar name={session.staff.name} size="sm" />
                {collapsed ? null : (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{session.staff.name}</span>
                    <span className="block truncate text-[11px] text-label-secondary">{session.staff.roleLabel}</span>
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block text-[13px] font-semibold text-foreground">{session.staff.name}</span>
                <span className="ltr block text-right text-[11px]">{session.staff.phone}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await api.resetDemoData();
                  await qc.invalidateQueries();
                  toast.success("داده‌های نمایشی بازنشانی شد");
                }}
              >
                <RotateCcw /> بازنشانی داده‌های نمایشی
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  await logout();
                  qc.clear();
                  navigate(paths.login);
                }}
              >
                <LogOut /> خروج از حساب
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {forceExpanded ? null : (
          <Button
            variant="ghost"
            size={collapsed ? "icon-sm" : "sm"}
            className={cn("text-label-secondary", !collapsed && "w-full justify-start")}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronsLeft /> : <ChevronsRight />}
            {collapsed ? null : "جمع کردن منو"}
          </Button>
        )}
      </div>
    </aside>
  );
}
