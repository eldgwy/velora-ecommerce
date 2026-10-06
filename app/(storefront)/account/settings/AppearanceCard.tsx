"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

/** No-op subscribe for `useSyncExternalStore` — the theme never "emits". */
const emptySubscribe = () => () => {};

/**
 * Light / dark / system picker backed by next-themes (the root layout's
 * ThemeProvider toggles the `.dark` class read by `globals.css`).
 */
export default function AppearanceCard() {
  const { theme, setTheme } = useTheme();

  // `theme` is only known after hydration — `useSyncExternalStore` gives the
  // classic client/server split without a `setState`-in-effect cascade.
  const isMounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  return (
    <Card className="rounded-2xl border border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Appearance</CardTitle>
        <CardDescription>
          Choose how Velora looks on this device.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div role="group" aria-label="Color theme" className="flex w-fit gap-2">
          {THEME_OPTIONS.map((option) => {
            const isActive = isMounted && theme === option.value;
            const Icon = option.icon;

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                disabled={!isMounted}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                  isActive
                    ? "border-velora-emerald bg-velora-emerald text-white"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <Icon className="size-4" />
                {option.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
