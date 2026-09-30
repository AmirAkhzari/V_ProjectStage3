export type Theme = "light" | "dark";

export const UI_STORAGE_KEY = "visitor-admin:ui:v1";
const LIGHT_BG = "#F2F2F7";
const DARK_BG = "#000000";

export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return "light";
    const parsed = JSON.parse(raw) as { state?: { theme?: string } };
    return parsed.state?.theme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? DARK_BG : LIGHT_BG);
}
