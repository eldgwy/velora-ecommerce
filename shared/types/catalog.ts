import { z } from "zod";

// ============================================
// Category
// ============================================

/** Slug: lowercase, hyphens, 3-64 chars. */
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Slug must be at least 3 characters.")
  .max(64, "Slug cannot exceed 64 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase letters, numbers, and hyphens.");

export const categorySchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1, "Name is required.").max(120, "Name cannot exceed 120 characters."),
    description: z.string().trim().max(500, "Description cannot exceed 500 characters.").optional(),
    logo: z.string().trim().max(500, "Logo URL cannot exceed 500 characters.").optional(),
    parentId: z.string().uuid("Invalid parent category ID.").nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

export type CategoryFormValues = z.infer<typeof categorySchema>;

// ============================================
// Brand
// ============================================

const websiteSchema = z
  .string()
  .trim()
  .url("Website must be a valid URL.")
  .max(255, "Website URL cannot exceed 255 characters.")
  .optional()
  .or(z.literal(""));

export const brandSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1, "Name is required.").max(120, "Name cannot exceed 120 characters."),
    description: z.string().trim().max(500, "Description cannot exceed 500 characters.").optional(),
    logo: z.string().trim().max(500, "Logo URL cannot exceed 500 characters.").optional(),
    website: websiteSchema,
    seoTitle: z.string().trim().max(160, "SEO title cannot exceed 160 characters.").optional(),
    seoDescription: z.string().trim().max(320, "SEO description cannot exceed 320 characters.").optional(),
  })
  .strict();

export type BrandFormValues = z.infer<typeof brandSchema>;

// ============================================
// Product
// ============================================

export const PRODUCT_STATUS = ["DRAFT", "ACTIVE", "ARCHIVE"] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

/** Slug: lowercase, hyphens, 3-64 chars. */
const productSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Slug must be at least 3 characters.")
  .max(64, "Slug cannot exceed 64 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase letters, numbers, and hyphens.");

export const productSchema = z
  .object({
    slug: productSlugSchema,
    name: z.string().trim().min(1, "Name is required.").max(200, "Name cannot exceed 200 characters."),
    description: z.string().trim().max(5000, "Description cannot exceed 5000 characters.").optional(),
    status: z.enum(PRODUCT_STATUS).default("DRAFT"),
    basePrice: z.coerce.number().positive("Base price must be greater than 0.").max(999999999.99, "Price is too large."),
    comparePrice: z.coerce
      .number()
      .positive("Compare price must be greater than 0.")
      .max(999999999.99, "Price is too large.")
      .optional(),
    categoryId: z.string().uuid("Invalid category ID."),
    brandId: z.string().uuid("Invalid brand ID."),
  })
  .strict()
  .refine(
    (data) => data.comparePrice === undefined || data.comparePrice >= data.basePrice,
    { message: "Compare price must be greater than or equal to base price.", path: ["comparePrice"] },
  );

export type ProductFormValues = z.infer<typeof productSchema>;

// ============================================
// Option
// ============================================

export const optionSchema = z
  .object({
    name: z.string().trim().min(1, "Option name is required.").max(60, "Option name cannot exceed 60 characters."),
    sortOrder: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type OptionFormValues = z.infer<typeof optionSchema>;

export const optionValueSchema = z
  .object({
    value: z.string().trim().min(1, "Value is required.").max(120, "Value cannot exceed 120 characters."),
    sortOrder: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type OptionValueFormValues = z.infer<typeof optionValueSchema>;

// ============================================
// Variant
// ============================================

/**
 * Normalize SKU: trim whitespace and convert to uppercase for consistent storage.
 */
function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

export const variantSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, "SKU is required.")
      .max(64, "SKU cannot exceed 64 characters.")
      .transform(normalizeSku),
    description: z.string().trim().max(500, "Description cannot exceed 500 characters.").optional(),
    priceOverride: z.coerce.number().positive("Price override must be greater than 0.").max(999999999.99).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVE"]).default("ACTIVE"),
    optionValueIds: z.array(z.string().uuid()).min(1, "At least one option value is required."),
  })
  .strict();

export type VariantFormValues = z.infer<typeof variantSchema>;

// ============================================
// Image
// ============================================

export const imageSchema = z
  .object({
    publicId: z.string().min(1, "Public ID is required."),
    url: z.string().url("URL must be a valid URL."),
    alt: z.string().trim().max(255, "Alt text cannot exceed 255 characters.").optional(),
    sortOrder: z.coerce.number().int().min(0).default(0),
    isPrimary: z.boolean().default(false),
  })
  .strict();

export type ImageFormValues = z.infer<typeof imageSchema>;

// ============================================
// IDs
// ============================================

export const uuidSchema = z.string().uuid("Invalid ID.");
export const slugParamSchema = z.string().min(3).max(64);