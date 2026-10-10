// ============================================
// Structured Logger
// ============================================

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  module: string;
  action: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, context: LogContext): void {
  const entry = {
    timestamp: formatTimestamp(),
    level,
    message,
    ...context,
  };

  // In production, this would go to a proper logging service
  // For now, use console with appropriate method
  const consoleMethod = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, context: LogContext) => log("debug", message, context),
  info: (message: string, context: LogContext) => log("info", message, context),
  warn: (message: string, context: LogContext) => log("warn", message, context),
  error: (message: string, context: LogContext) => log("error", message, context),

  // Catalog-specific helpers
  catalog: {
    categoryCreated: (categoryId: string, userId: string, requestId?: string) =>
      log("info", "Category created", { module: "catalog", action: "categoryCreated", categoryId, userId, requestId }),

    categoryUpdated: (categoryId: string, changes: string[], userId: string, requestId?: string) =>
      log("info", "Category updated", { module: "catalog", action: "categoryUpdated", categoryId, changes, userId, requestId }),

    categoryActivated: (categoryId: string, isActive: boolean, userId: string, requestId?: string) =>
      log("info", "Category activation changed", { module: "catalog", action: "categoryActivated", categoryId, isActive, userId, requestId }),

    categoryParentChanged: (categoryId: string, oldParentId: string | null, newParentId: string | null, userId: string, requestId?: string) =>
      log("info", "Category parent changed", { module: "catalog", action: "categoryParentChanged", categoryId, oldParentId, newParentId, userId, requestId }),

    brandCreated: (brandId: string, userId: string, requestId?: string) =>
      log("info", "Brand created", { module: "catalog", action: "brandCreated", brandId, userId, requestId }),

    brandUpdated: (brandId: string, changes: string[], userId: string, requestId?: string) =>
      log("info", "Brand updated", { module: "catalog", action: "brandUpdated", brandId, changes, userId, requestId }),

    brandDeleted: (brandId: string, userId: string, requestId?: string) =>
      log("info", "Brand deleted", { module: "catalog", action: "brandDeleted", brandId, userId, requestId }),

    productCreated: (productId: string, userId: string, requestId?: string) =>
      log("info", "Product created", { module: "catalog", action: "productCreated", productId, userId, requestId }),

    productUpdated: (productId: string, changes: string[], userId: string, requestId?: string) =>
      log("info", "Product updated", { module: "catalog", action: "productUpdated", productId, changes, userId, requestId }),

    productStatusChanged: (productId: string, oldStatus: string, newStatus: string, userId: string, requestId?: string) =>
      log("info", "Product status changed", { module: "catalog", action: "productStatusChanged", productId, oldStatus, newStatus, userId, requestId }),

    productDeleted: (productId: string, userId: string, requestId?: string) =>
      log("info", "Product deleted", { module: "catalog", action: "productDeleted", productId, userId, requestId }),

    variantCreated: (variantId: string, productId: string, userId: string, requestId?: string) =>
      log("info", "Product variant created", { module: "catalog", action: "variantCreated", variantId, productId, userId, requestId }),

    variantUpdated: (variantId: string, changes: string[], userId: string, requestId?: string) =>
      log("info", "Product variant updated", { module: "catalog", action: "variantUpdated", variantId, changes, userId, requestId }),

    variantOptionValuesSet: (variantId: string, optionValueIds: string[], userId: string, requestId?: string) =>
      log("info", "Variant option values set", { module: "catalog", action: "variantOptionValuesSet", variantId, optionValueIds, userId, requestId }),

    imageCreated: (imageId: string, productId: string, isPrimary: boolean, userId: string, requestId?: string) =>
      log("info", "Product image created", { module: "catalog", action: "imageCreated", imageId, productId, isPrimary, userId, requestId }),

    imageUpdated: (imageId: string, changes: string[], userId: string, requestId?: string) =>
      log("info", "Product image updated", { module: "catalog", action: "imageUpdated", imageId, changes, userId, requestId }),

    imagePrimarySet: (imageId: string, productId: string, userId: string, requestId?: string) =>
      log("info", "Primary image set", { module: "catalog", action: "imagePrimarySet", imageId, productId, userId, requestId }),

    imageDeleted: (imageId: string, productId: string, wasPrimary: boolean, userId: string, requestId?: string) =>
      log("info", "Product image deleted", { module: "catalog", action: "imageDeleted", imageId, productId, wasPrimary, userId, requestId }),

    inventoryMovementCreated: (inventoryId: string, type: string, quantity: number, userId: string, requestId?: string) =>
      log("info", "Inventory movement created", { module: "catalog", action: "inventoryMovementCreated", inventoryId, type, quantity, userId, requestId }),

    reviewModerated: (reviewId: string, productId: string, fromStatus: string, toStatus: string, userId: string, requestId?: string) =>
      log("info", "Review status changed", { module: "catalog", action: "reviewModerated", reviewId, productId, fromStatus, toStatus, userId, requestId }),

    inventoryAdjusted: (inventoryId: string, variantId: string, type: string, delta: number, userId: string, requestId?: string) =>
      log("info", "Inventory adjusted", { module: "catalog", action: "inventoryAdjusted", inventoryId, variantId, type, delta, userId, requestId }),
  },
};