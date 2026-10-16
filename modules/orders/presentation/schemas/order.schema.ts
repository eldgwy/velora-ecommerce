import { z } from "zod";

export const orderIdSchema = z.string().uuid("Invalid order identifier.");

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
  .optional();

export const adminOrderFiltersSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]).optional(),
  paymentStatus: z
    .enum(["PAID", "AUTHORIZED", "PENDING", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "REQUIRES_ACTION", "EXPIRED"])
    .optional(),
  customer: z.string().trim().max(120).optional(),
  orderNumber: z.string().trim().max(32).optional(),
  from: dateString,
  to: dateString,
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const cancelReasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required for manual cancellation.")
  .max(500, "Reason cannot exceed 500 characters.");
