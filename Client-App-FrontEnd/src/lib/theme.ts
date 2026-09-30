export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "visitor:ui:v1";
export const CREAM = "#F2F2F7";
export const INK = "#000000";

export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? INK : CREAM);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute(
    "content",
    theme === "dark" ? "black-translucent" : "default",
  );
}
