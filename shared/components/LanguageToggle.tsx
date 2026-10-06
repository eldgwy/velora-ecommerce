"use client";

import { cn } from "@/shared/lib/utils";
import { PREFERRED_LANGUAGES } from "@/shared/types/profile";

interface LanguageToggleProps {
  value: "en" | "ar";
  onValueChange: (value: "en" | "ar") => void;
  disabled?: boolean;
}

const LANGUAGE_LABELS: Record<"en" | "ar", string> = {
  en: "English",
  ar: "العربية",
};

/**
 * Segmented `en` / `ar` switch used by the Profile form and the Settings
 * preferences card (SRS FR-02.01 `preferredLanguage`).
 */
export default function LanguageToggle({
  value,
  onValueChange,
  disabled = false,
}: LanguageToggleProps) {
  return (
    <div
      role="group"
      aria-label="Preferred language"
      className="flex w-fit gap-2"
    >
      {PREFERRED_LANGUAGES.map((language) => {
        const isActive = value === language;

        return (
          <button
            key={language}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => onValueChange(language)}
            className={cn(
              "rounded-lg border px-4 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
              isActive
                ? "border-velora-emerald bg-velora-emerald text-white"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            {LANGUAGE_LABELS[language]}
          </button>
        );
      })}
    </div>
  );
}
