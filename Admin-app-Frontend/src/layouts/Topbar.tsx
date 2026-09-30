import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ThemeToggle from "@/components/shared/ThemeToggle";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import NotificationsPopover from "./NotificationsPopover";
import { findNavLabel } from "@/routes/nav";
import { paths } from "@/routes/paths";
import { useIsDistributorAdmin, useSessionStore } from "@/store/useSessionStore";
import { useAllDistributors } from "@/features/catalog";

export default function Topbar() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isDistributor = useIsDistributorAdmin();
  const active = useSessionStore((s) => s.activeDistributorId);
  const setActive = useSessionStore((s) => s.setActiveDistributor);
  const { data: distributors } = useAllDistributors();
  const label = findNavLabel(location.pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-page/85 px-4 backdrop-blur md:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="منو">
        <Menu />
      </Button>
      <nav className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <Link to={paths.dashboard} className="text-label-secondary hover:text-foreground">
          ویزیتور
        </Link>
        {label ? (
          <>
            <span className="text-label-tertiary">/</span>
            <span className="truncate font-semibold">{label}</span>
          </>
        ) : null}
      </nav>

      <div className="mr-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden h-9 w-64 items-center gap-2 rounded-lg bg-fill px-3 text-[12px] text-label-secondary hover:bg-fill-secondary md:flex"
        >
          <Search className="size-4" />
          <span className="flex-1 text-right">جستجو در پنل…</span>
          <kbd className="ltr rounded-md bg-card px-1.5 py-0.5 text-[10px] font-semibold text-label-secondary">⌘K</kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setPaletteOpen(true)}
          aria-label="جستجو"
        >
          <Search />
        </Button>

        {!isDistributor && distributors ? (
          <Select value={active ?? "all"} onValueChange={(v) => setActive(v === "all" ? null : v)}>
            <SelectTrigger size="sm" className="hidden w-52 bg-fill sm:flex">
              <span className="flex items-center gap-2 truncate">
                <Truck className="size-3.5 shrink-0 text-label-secondary" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه شرکت‌های پخش</SelectItem>
              {distributors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <ThemeToggle />
        <NotificationsPopover />
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-[280px] p-0">
          <SheetTitle className="sr-only">منو</SheetTitle>
          <Sidebar forceExpanded onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
