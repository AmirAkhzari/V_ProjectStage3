import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Moon, Store, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV } from "@/routes/nav";
import { paths } from "@/routes/paths";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import { hasPermission } from "@/lib/permissions";
import { useOrders } from "@/features/orders";
import { useRetailers } from "@/features/people";
import { normalizePersian } from "@/lib/format";

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const permissions = useSessionStore((s) => s.session?.permissions);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const theme = useUiStore((s) => s.theme);
  const { data: orders } = useOrders();
  const { data: retailers } = useRetailers();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = normalizePersian(query.trim());
  const orderHits = useMemo(
    () =>
      q.length < 2
        ? []
        : (orders ?? []).filter((o) => normalizePersian(`${o.number} ${o.retailerName}`).includes(q)).slice(0, 5),
    [orders, q],
  );
  const retailerHits = useMemo(
    () =>
      q.length < 2
        ? []
        : (retailers ?? []).filter((r) => normalizePersian(`${r.name} ${r.phone}`).includes(q)).slice(0, 5),
    [retailers, q],
  );

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="جستجوی صفحه، شماره سفارش یا فروشگاه…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>نتیجه‌ای یافت نشد</CommandEmpty>
        {orderHits.length ? (
          <CommandGroup heading="سفارش‌ها">
            {orderHits.map((o) => (
              <CommandItem
                key={o.id}
                value={`order ${o.number} ${o.retailerName}`}
                onSelect={() => go(paths.order(o.id))}
              >
                <ClipboardList />
                <span className="ltr">{o.number}</span>
                <span className="text-label-secondary">· {o.retailerName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {retailerHits.length ? (
          <CommandGroup heading="فروشگاه‌ها">
            {retailerHits.map((r) => (
              <CommandItem key={r.id} value={`retailer ${r.name} ${r.phone}`} onSelect={() => go(paths.retailer(r.id))}>
                <Store />
                <span>{r.name}</span>
                <span className="text-label-secondary">· {r.city}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="صفحات">
          {NAV.flatMap((g) => g.items)
            .filter((i) => hasPermission(permissions, i.perm))
            .map((item) => (
              <CommandItem key={item.to} value={`page ${item.label}`} onSelect={() => go(item.to)}>
                <item.icon />
                {item.label}
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="عملیات">
          <CommandItem
            value="theme toggle حالت تیره روشن"
            onSelect={() => {
              toggleTheme();
              onOpenChange(false);
            }}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "حالت روشن" : "حالت تیره"}
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
