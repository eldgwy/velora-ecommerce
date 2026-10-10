import { z } from "zod";

// ============================================
// Customer profile (SRS FR-02.01)
// ============================================

/** Supported UI languages — SRS FR-02.01: `preferredLanguage` (`'en' | 'ar'`). */
export const PREFERRED_LANGUAGES = ["en", "ar"] as const;

export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];

/**
 * E.164 international phone number: `+` followed by 2–15 digits where the
 * first digit is 1–9 (ITU-T recommendation, max 15 digits total).
 */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/** A `YYYY-MM-DD` calendar date that exists and is not in the future. */
function isPastDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  // Out-of-range components (e.g. 2026-02-31) produce an invalid date.
  if (Number.isNaN(parsed.getTime())) return false;

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return parsed.getTime() <= todayUtc;
}

/**
 * Mutable profile fields (SRS FR-02.01). `id` and `userId` are deliberately
 * absent — they are immutable server-side and can never be supplied by input.
 *
 * `.strict()` rejects any extra key (including a malicious `id`/`userId`)
 * with a 422 instead of silently dropping it from the update.
 */
export const profileSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, "First name is required.")
      .max(100, "First name cannot exceed 100 characters."),

    middleName: z
      .string()
      .trim()
      .max(100, "Middle name cannot exceed 100 characters.")
      .optional(),

    lastName: z
      .string()
      .trim()
      .min(1, "Last name is required.")
      .max(100, "Last name cannot exceed 100 characters."),

    // E.164 format; an empty string clears the stored value.
    phone: z
      .string()
      .trim()
      .refine((value) => value === "" || E164_REGEX.test(value), {
        message: "Phone must use E.164 format, e.g. +15551234567.",
      })
      .optional(),

    // `YYYY-MM-DD` (or empty to clear); converted to a Date in the action.
    birthday: z
      .string()
      .refine((value) => value === "" || isPastDateString(value), {
        message: "Enter a valid date of birth.",
      })
      .optional(),

    preferredLanguage: z.enum(PREFERRED_LANGUAGES),
  })
  .strict();

/**
 * Partial variant used by the Settings page — updates a strict subset of the
 * mutable fields while still validating each field that is present.
 */
export const profileUpdateSchema = profileSchema
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "No changes to save." },
  );

export type ProfileFormValues = z.infer<typeof profileSchema>;

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
