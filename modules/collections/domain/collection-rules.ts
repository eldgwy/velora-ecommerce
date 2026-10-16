import { CollectionValidationError } from "./collection-errors";

/**
 * Collection slug and field rules (domain layer — pure).
 *
 * Slugs are URL-safe, lowercase, dash-separated, 3–64 chars. Uniqueness is
 * enforced by the database; normalization here keeps creation, updates,
 * and lookups consistent.
 */

export const COLLECTION_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MIN_SLUG_LENGTH = 3;
export const MAX_SLUG_LENGTH = 64;
export const MAX_NAME_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;

/** Lowercase, trim, collapse separators; throws when the result is illegal. */
export function normalizeCollectionSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (
    slug.length < MIN_SLUG_LENGTH ||
    slug.length > MAX_SLUG_LENGTH ||
    !COLLECTION_SLUG_PATTERN.test(slug)
  ) {
    throw new CollectionValidationError(
      "Slug must be 3–64 characters of lowercase letters, numbers, and single dashes.",
    );
  }
  return slug;
}

/** Derive a slug from a display name (admin may override with `slug`). */
export function slugifyCollectionName(name: string): string {
  return normalizeCollectionSlug(name);
}

export function assertCollectionName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new CollectionValidationError(
      `Collection name must be 1–${MAX_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export function assertCollectionDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new CollectionValidationError(
      `Description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/** Cover image: HTTPS URL recorded from the provider-signed upload. */
export function assertCollectionImage(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CollectionValidationError("Cover image URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new CollectionValidationError("Cover image URL must use HTTPS.");
  }
  return url.toString();
}
