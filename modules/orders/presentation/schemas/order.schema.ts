import { z } from "zod";

export const orderIdSchema = z.string().uuid("Invalid order identifier.");

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const adminOrderFiltersSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]).optional(),
  paymentStatus: z
    .enum(["PAID", "AUTHORIZED", "PENDING", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "REQUIRES_ACTION", "EXPIRED"])
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const cancelReasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required for manual cancellation.")
  .max(500, "Reason cannot exceed 500 characters.");
