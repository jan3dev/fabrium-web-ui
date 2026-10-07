import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BRAND_COLORS } from "@/components/brand/colors";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeProviderState>({
  theme: "dark",
  setTheme: () => null,
});

// Also read by the bootstrap script in index.html, which applies it before first paint.
export const THEME_STORAGE_KEY = "fabrium:theme:v1";

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" || value === "system" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(resolved: "dark" | "light") {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? BRAND_COLORS.background : BRAND_COLORS.foreground);
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? defaultTheme);

  useEffect(() => {
    if (theme !== "system") {
      applyTheme(theme);
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme(query.matches ? "dark" : "light");
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [theme]);

  const setTheme = (next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
    setThemeState(next);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeProviderState {
  return useContext(ThemeContext);
}
