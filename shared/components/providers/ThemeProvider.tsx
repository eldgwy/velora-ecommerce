"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  resolvedTheme: "light" | "dark";
  systemTheme: "light" | "dark";
  themes: ThemeChoice[];
}

const STORAGE_KEY = "theme";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => undefined,
  resolvedTheme: "light",
  systemTheme: "light",
  themes: ["light", "dark", "system"],
});

function systemIsDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private mode etc: fall through to the default.
  }
  return "system";
}

function currentSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return systemIsDark() ? "dark" : "light";
}

/** Apply the resolved theme to <html> without CSS transition flashes. */
function applyTheme(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}",
    ),
  );
  document.head.appendChild(style);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  window.getComputedStyle(document.body);
  window.setTimeout(() => {
    document.head.removeChild(style);
  }, 1);
}

/**
 * First-party theme provider (replaces next-themes, whose in-tree
 * `<script>` trips React 19's "script tag while rendering" error).
 * Same contract the app already uses: `.dark` class on `<html>` (read by
 * `globals.css`), `theme` key in localStorage, `system` default, media +
 * cross-tab sync. The pre-paint blocking snippet lives in the root layout
 * as a plain `<script>` in `<body>` so there is no flash and no
 * client-rendered script.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initializers read the browser only on the client; the server
  // always starts at the default. The blocking pre-paint script has
  // already applied the matching class, so there is no flash and the
  // values below never reach the DOM directly (consumers gate on mount).
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStoredTheme());
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => currentSystemTheme());
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    // Subscriptions only: the lazy initializers above already captured the
    // live values at mount, so the effect body itself sets no state.
    // Re-apply the class in case storage changed between init and mount.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = readStoredTheme();
    applyTheme(stored === "system" ? (media.matches ? "dark" : "light") : stored);
    const onMedia = () => {
      const system: "light" | "dark" = media.matches ? "dark" : "light";
      setSystemTheme(system);
      if (readStoredTheme() === "system") applyTheme(system);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStoredTheme();
      setThemeState(next);
      applyTheme(next === "system" ? (media.matches ? "dark" : "light") : next);
    };
    media.addEventListener("change", onMedia);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onMedia);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore persistence failures; the choice still applies this session.
    }
    applyTheme(next === "system" ? (systemIsDark() ? "dark" : "light") : next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolvedTheme, systemTheme, themes: ["light", "dark", "system"] }),
    [theme, setTheme, resolvedTheme, systemTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Drop-in for the `useTheme()` calls previously served by next-themes. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
