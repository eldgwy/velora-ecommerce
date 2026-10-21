import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import { env } from "@/config/env";

// ============================================
// Cloudinary Client (server-only)
// ============================================

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const cloudinaryClient = cloudinary;

// ============================================
// Signed Upload
// ============================================

export interface SignedUploadParams {
  folder?: string;
  publicId?: string;
  tags?: string[];
  overwrite?: boolean;
  invalidate?: boolean;
}

export interface SignedUploadResult {
  publicId: string;
  secureUrl: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  resourceType: string;
  createdAt: string;
}

/**
 * Generate a signed upload URL for client-side uploads.
 * The client never sees the API secret.
 */
export function createSignedUploadParams(
  params: SignedUploadParams = {},
): {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  uploadPreset?: string;
} {
  const timestamp = Math.round(Date.now() / 1000);
  const folder = params.folder || "velora/products";

  const signatureParams: Record<string, unknown> = {
    timestamp,
    folder,
  };

  if (params.publicId) signatureParams.public_id = params.publicId;
  if (params.tags) signatureParams.tags = params.tags.join(",");
  if (params.overwrite !== undefined) signatureParams.overwrite = params.overwrite;
  if (params.invalidate !== undefined) signatureParams.invalidate = params.invalidate;

  const signature = cloudinary.utils.api_sign_request(
    signatureParams,
    env.CLOUDINARY_API_SECRET,
  );

  return {
    timestamp,
    signature,
    apiKey: env.CLOUDINARY_API_KEY,
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    folder,
    uploadPreset: env.CLOUDINARY_UPLOAD_PRESET,
  };
}

/**
 * Upload a file buffer to Cloudinary (server-side).
 */
export async function uploadImage(
  buffer: Buffer,
  params: SignedUploadParams = {},
): Promise<SignedUploadResult> {
  const folder = params.folder || "velora/products";

  const options: UploadApiOptions = {
    folder,
    resource_type: "image",
    overwrite: params.overwrite ?? true,
    invalidate: params.invalidate ?? true,
    tags: params.tags,
  };

  if (params.publicId) options.public_id = params.publicId;

  const result: UploadApiResponse = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(options, (error, result) => {
        if (error) reject(error);
        else resolve(result!);
      })
      .end(buffer);
  });

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    format: result.format,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    resourceType: result.resource_type,
    createdAt: result.created_at,
  };
}

/**
 * Delete a Cloudinary asset by public ID.
 */
export async function deleteImage(publicId: string): Promise<boolean> {
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Image Validation
// ============================================
// Canonical definitions live in the shared, browser-safe module so the
// review form can run the exact same rules client-side (GP-15): the server
// never sees review uploads (they go browser → provider directly), so the
// single source of truth must be importable by both bundles.
export {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  validateImageFile,
} from "@/shared/lib/image-validation";
export type { ImageValidationResult } from "@/shared/lib/image-validation";