"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LanguagesIcon } from "lucide-react";

import { updateProfile } from "@/shared/lib/actions/profile";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Spinner } from "@/shared/components/ui/spinner";
import LanguageToggle from "@/shared/components/LanguageToggle";

interface PreferencesCardProps {
  language: "en" | "ar";
}

/**
 * Quick language preference control (SRS FR-02.01 `preferredLanguage`) —
 * writes through the same `profile.updateProfile` server action the Profile
 * form uses, optimistically then confirmed by `router.refresh()`.
 */
export default function PreferencesCard({ language }: PreferencesCardProps) {
  const router = useRouter();
  const [value, setValue] = React.useState<"en" | "ar">(language);
  const [isSaving, setIsSaving] = React.useState(false);

  async function handleLanguageChange(next: "en" | "ar") {
    if (next === value || isSaving) return;

    const previous = value;
    setValue(next);
    setIsSaving(true);

    try {
      const result = await updateProfile({ preferredLanguage: next });

      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
        return;
      }

      toast.success(
        next === "ar" ? "تم حفظ اللغة العربية." : "Language preference saved.",
      );
      router.refresh();
    } catch (err: unknown) {
      setValue(previous);
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while saving your preference.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="rounded-2xl border border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LanguagesIcon className="size-4 text-muted-foreground" />
          Preferences
        </CardTitle>
        <CardDescription>
          Language used for emails, notifications and localized content.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex items-center gap-3">
        <LanguageToggle
          value={value}
          onValueChange={handleLanguageChange}
          disabled={isSaving}
        />
        {isSaving && <Spinner className="size-4 text-muted-foreground" />}
      </CardContent>
    </Card>
  );
}
