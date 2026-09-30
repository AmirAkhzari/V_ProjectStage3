import { NavLink } from "react-router-dom";
import { IconBag, IconHome, IconPerson, IconReceipt } from "@/components/icons";
import { useCartMeta } from "@/store/useAppStore";
import { toFaNum } from "@/lib/format";

const tabs = [
  { to: "/profile", label: "پروفایل", Icon: IconPerson },
  { to: "/cart", label: "سبد خرید", Icon: IconBag, badge: true },
  { to: "/orders", label: "سفارش‌ها", Icon: IconReceipt },
  { to: "/", label: "خانه", Icon: IconHome, end: true },
];

export default function TabBar() {
  const { qty } = useCartMeta();
  return (
    <nav dir="ltr" className="relative z-10 bg-card/80 backdrop-blur-xl border-t border-separator flex shrink-0 pb-[max(6px,env(safe-area-inset-bottom))]">
      {tabs.map(({ to, label, Icon, end, badge }) => (
        <NavLink key={to} to={to} end={end} className="flex-1 outline-none">
          {({ isActive }) => (
            <span className="flex flex-col items-center justify-center min-h-11 py-1.5 gap-0.5">
              <span className={`relative ${isActive ? "text-accent" : "text-secondary"}`}>
                <Icon active={isActive} />
                {badge && qty > 0 && (
                  <span className="absolute -top-1.5 -left-2 min-w-4 h-4 px-1 rounded-full bg-error text-inverse text-[10px] font-semibold flex items-center justify-center">
                    {toFaNum(qty)}
                  </span>
                )}
              </span>
              <span className={`text-[12px] font-medium ${isActive ? "text-accent" : "text-secondary"}`}>{label}</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
