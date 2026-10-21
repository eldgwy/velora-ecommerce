/**
 * UGC image-file validation (GP-15 / T-2.9).
 *
 * Pure and dependency-free so it can be imported by BOTH the browser bundle
 * (client-side pre-flight in the review form) and server modules. The
 * Cloudinary client re-exports these as the single canonical source — the
 * previously duplicated ad-hoc checks in the review form were removed.
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

export function validateImageFile(params: {
  mimeType: string;
  size: number;
  filename?: string;
}): ImageValidationResult {
  if (!ALLOWED_IMAGE_TYPES.includes(params.mimeType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return {
      valid: false,
      error: `Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, AVIF.`,
    };
  }

  if (params.size > MAX_IMAGE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB.`,
    };
  }

  if (params.size === 0) {
    return { valid: false, error: "File is empty." };
  }

  return { valid: true };
}
