import { IconMoon, IconSun } from "@/components/icons";
import { useAppStore } from "@/store/useAppStore";

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="حالت تیره"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={
        compact
          ? "w-10 h-10 rounded-full bg-fill text-accent flex items-center justify-center"
          : `relative w-[51px] h-[31px] rounded-full transition-colors ${dark ? "bg-accent" : "bg-gray-5"}`
      }
    >
      {compact ? (
        dark ? <IconSun size={18} /> : <IconMoon size={18} />
      ) : (
        <span
          className={`absolute top-[2px] size-[27px] rounded-full bg-inverse transition-[inset-inline-start] ${dark ? "start-[2px]" : "start-[22px]"}`}
        />
      )}
    </button>
  );
}
