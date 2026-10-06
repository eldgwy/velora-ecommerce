"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * next-themes wrapper — toggles the `.dark` class that `globals.css`'s
 * `@custom-variant dark (&:is(.dark *))` keys off. `system` is the default
 * until the user picks a theme on `/settings`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
