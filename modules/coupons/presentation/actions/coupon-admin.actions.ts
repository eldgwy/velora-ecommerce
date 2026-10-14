"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  createCoupon,
  setCouponActive,
  updateCoupon,
} from "@/modules/coupons/application/commands/coupons";
import {
  getCouponDetail,
  listCoupons,
  type CouponDetail,
  type CouponList,
  type CouponStatusFilter,
} from "@/modules/coupons/application/queries/coupons";
import {
  CouponConflictError,
  CouponNotFoundError,
  CouponValidationError,
} from "@/modules/coupons/domain/coupon-errors";

const optionalDate = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v !== "string") return v;
  // `datetime-local` inputs carry no zone; interpret them as UTC so stored
  // walls match the repository's UTC convention regardless of server locale.
  const m = v.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if (m) return new Date(`${m[1]}${m[2] ?? ":00"}Z`);
  return v;
}, z.coerce.date().optional());

const optionalInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().min(0).max(1_000_000_000).optional(),
);

const couponFormSchema = z.object({
  code: z.string().trim().min(1, "Code is required."),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.string().trim().min(1, "Value is required."),
  minimumOrderAmount: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().min(1).optional(),
    ),
  maximumDiscountAmount: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().min(1).optional(),
    ),
  usageLimit: optionalInt,
  perUserLimit: optionalInt,
  startsAt: optionalDate,
  expiresAt: optionalDate,
  isActive: z.coerce.boolean().optional().default(true),
});

const listSchema = z.object({
  query: z.string().max(64).optional(),
  status: z.enum(["all", "active", "inactive", "scheduled", "expired", "exhausted"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function couponFailure(action: string, error: unknown): ActionResult<never> {
  if (
    error instanceof CouponNotFoundError ||
    error instanceof CouponConflictError ||
    error instanceof CouponValidationError
  ) {
    // Domain messages are safe to surface (no internals by construction).
    return { ok: false, error: error.message };
  }
  logger.error(`Coupon admin action failed: ${action}`, {
    module: "coupons",
    action,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That coupon action could not be completed." };
}

/** Paginated, searchable coupon list (admin-gated). */
export async function listCouponsAction(input: unknown): Promise<ActionResult<CouponList>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const result = await listCoupons({
    query: parsed.data.query,
    status: parsed.data.status as CouponStatusFilter | undefined,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  return { ok: true, data: result };
}

/** Single coupon with redemption history (admin-gated). */
export async function getCouponDetailAction(input: unknown): Promise<ActionResult<CouponDetail>> {
  await requireAdmin();
  const parsed = z.string().uuid("Invalid coupon.").safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid coupon." };
  const detail = await getCouponDetail(parsed.data);
  if (!detail) return { ok: false, error: "Coupon not found." };
  return { ok: true, data: detail };
}

/** Create a coupon (admin-gated). Codes normalize uppercase; dupes conflict. */
export async function createCouponAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireAdmin();
  const parsed = couponFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid coupon details." };
  }
  try {
    const result = await createCoupon({
      code: parsed.data.code,
      type: parsed.data.type,
      value: parsed.data.value,
      minimumOrderAmount: parsed.data.minimumOrderAmount ?? null,
      maximumDiscountAmount: parsed.data.maximumDiscountAmount ?? null,
      usageLimit: parsed.data.usageLimit ?? null,
      perUserLimit: parsed.data.perUserLimit ?? null,
      startsAt: parsed.data.startsAt ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      isActive: parsed.data.isActive,
      actorId: session.user.id,
    });
    return { ok: true, data: result };
  } catch (error) {
    return couponFailure("createCoupon", error) as ActionResult<{ id: string }>;
  }
}

/**
 * Update a coupon. Historical orders keep their snapshots, so edits never
 * rewrite financial history; a limit below consumed usage is rejected.
 */
export async function updateCouponAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = couponFormSchema
    .extend({ id: z.string().uuid("Invalid coupon.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid coupon details." };
  }
  try {
    await updateCoupon({
      id: parsed.data.id,
      code: parsed.data.code,
      type: parsed.data.type,
      value: parsed.data.value,
      minimumOrderAmount: parsed.data.minimumOrderAmount ?? null,
      maximumDiscountAmount: parsed.data.maximumDiscountAmount ?? null,
      usageLimit: parsed.data.usageLimit ?? null,
      perUserLimit: parsed.data.perUserLimit ?? null,
      startsAt: parsed.data.startsAt ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      isActive: parsed.data.isActive,
    });
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    return couponFailure("updateCoupon", error) as ActionResult<{ id: string }>;
  }
}

/** Activate/deactivate. Live validation reads the flag; history untouched. */
export async function setCouponActiveAction(
  input: unknown,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid("Invalid coupon."), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid coupon." };
  try {
    await setCouponActive(parsed.data.id, parsed.data.isActive);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return couponFailure("setCouponActive", error) as ActionResult<{
      id: string;
      isActive: boolean;
    }>;
  }
}
