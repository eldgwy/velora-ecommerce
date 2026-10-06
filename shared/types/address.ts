import { z } from "zod";

// ============================================
// Address book (SRS FR-02.02)
// ============================================

/**
 * Address book entry — mirrors the `addresses` table columns accepted by
 * `Create Address` / `Update Address` (SRS FR-02.02).
 *
 * `.strict()` rejects any extra key (including a malicious `id`,
 * `customerId`, `createdAt`, or `updatedAt`) with a 422 instead of silently
 * dropping it from the update.
 */
export const addressSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Label is required, e.g. Home or Office.")
      .max(40, "Label cannot exceed 40 characters."),

    addressLine1: z
      .string()
      .trim()
      .max(200, "Address line cannot exceed 200 characters.")
      .optional(),

    addressLine2: z
      .string()
      .trim()
      .max(200, "Address line cannot exceed 200 characters.")
      .optional(),

    addressLine3: z
      .string()
      .trim()
      .max(200, "Address line cannot exceed 200 characters.")
      .optional(),

    city: z
      .string()
      .trim()
      .min(1, "City is required.")
      .max(120, "City cannot exceed 120 characters."),

    state: z
      .string()
      .trim()
      .min(1, "State or region is required.")
      .max(120, "State cannot exceed 120 characters."),

    postalCode: z
      .string()
      .trim()
      .min(1, "Postal code is required.")
      .max(32, "Postal code cannot exceed 32 characters."),

    country: z
      .string()
      .trim()
      .min(1, "Country is required.")
      .max(80, "Country cannot exceed 80 characters."),

    isDefault: z.boolean(),
  })
  .strict();

/** Address id path parameter — rejects malformed UUIDs before they reach SQL. */
export const addressIdSchema = z.uuid();

export type AddressFormValues = z.infer<typeof addressSchema>;
