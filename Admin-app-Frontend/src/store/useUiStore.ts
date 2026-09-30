import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyTheme, readStoredTheme, UI_STORAGE_KEY, type Theme } from "@/lib/theme";

type UiState = {
  theme: Theme;
  sidebarCollapsed: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: typeof document === "undefined" ? "light" : readStoredTheme(),
      sidebarCollapsed: false,
      setTheme(theme) {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme() {
        get().setTheme(get().theme === "dark" ? "light" : "dark");
      },
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    { name: UI_STORAGE_KEY },
  ),
);
