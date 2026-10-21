import { describe, it, expect } from "vitest";

import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  validateImageFile,
} from "@/shared/lib/image-validation";

describe("validateImageFile", () => {
  it("accepts every allowed mime type at the size limit", () => {
    for (const mimeType of ALLOWED_IMAGE_TYPES) {
      const result = validateImageFile({ mimeType, size: MAX_IMAGE_SIZE });
      expect(result.valid, `expected ${mimeType} accepted`).toBe(true);
    }
  });

  it("rejects unsupported mime types", () => {
    for (const mimeType of ["text/html", "application/pdf", "image/svg+xml", ""]) {
      const result = validateImageFile({ mimeType, size: 1024 });
      expect(result.valid, `expected ${mimeType} rejected`).toBe(false);
      expect(result.error).toMatch(/Unsupported file type/);
    }
  });

  it("rejects oversized files", () => {
    const result = validateImageFile({ mimeType: "image/jpeg", size: MAX_IMAGE_SIZE + 1 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/File too large/);
  });

  it("rejects empty files", () => {
    const result = validateImageFile({ mimeType: "image/png", size: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });
});
