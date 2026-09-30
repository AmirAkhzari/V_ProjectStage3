export type Theme = "light" | "dark";

const LIGHT_BG = "#F2F2F7";
const DARK_BG = "#000000";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? DARK_BG : LIGHT_BG);
}
