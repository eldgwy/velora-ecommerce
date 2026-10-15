"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  createPromotion,
  mapProductToPromotion,
  setPromotionActive,
  unmapProductFromPromotion,
  updatePromotion,
} from "@/modules/promotions/application/commands/promotions";
import {
  getPromotionDetail,
  listPromotions,
  searchProductsForMapping,
  type ProductSearchRow,
  type PromotionDetail,
  type PromotionList,
  type PromotionStatusFilter,
} from "@/modules/promotions/application/queries/promotions";
import {
  PromotionConflictError,
  PromotionNotFoundError,
  PromotionValidationError,
} from "@/modules/promotions/domain/promotion-errors";

const optionalDate = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v !== "string") return v;
  // `datetime-local` inputs carry no zone; interpret them as UTC so stored
  // walls match the repository's UTC convention regardless of server locale.
  const m = v.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if (m) return new Date(`${m[1]}${m[2] ?? ":00"}Z`);
  return v;
}, z.coerce.date().optional());

const promotionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(1000).optional(),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.string().trim().min(1, "Value is required."),
  startsAt: optionalDate,
  endsAt: optionalDate,
  isActive: z.coerce.boolean().optional().default(true),
});

const listSchema = z.object({
  query: z.string().max(120).optional(),
  status: z.enum(["all", "active", "inactive", "scheduled", "expired"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function promotionFailure(action: string, error: unknown): ActionResult<never> {
  if (
    error instanceof PromotionNotFoundError ||
    error instanceof PromotionConflictError ||
    error instanceof PromotionValidationError
  ) {
    return { ok: false, error: error.message };
  }
  logger.error(`Promotion admin action failed: ${action}`, {
    module: "promotions",
    action,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That promotion action could not be completed." };
}

/** Paginated, searchable promotion list (admin-gated). */
export async function listPromotionsAction(input: unknown): Promise<ActionResult<PromotionList>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const result = await listPromotions({
    query: parsed.data.query,
    status: parsed.data.status as PromotionStatusFilter | undefined,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  return { ok: true, data: result };
}

/** Single promotion with mapped products (admin-gated). */
export async function getPromotionDetailAction(
  input: unknown,
): Promise<ActionResult<PromotionDetail>> {
  await requireAdmin();
  const parsed = z.string().uuid("Invalid promotion.").safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid promotion." };
  const detail = await getPromotionDetail(parsed.data);
  if (!detail) return { ok: false, error: "Promotion not found." };
  return { ok: true, data: detail };
}

/** Create a promotion (admin-gated). Mappings are added separately. */
export async function createPromotionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = promotionFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid promotion details." };
  }
  try {
    const result = await createPromotion({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      type: parsed.data.type,
      value: parsed.data.value,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      isActive: parsed.data.isActive,
    });
    return { ok: true, data: result };
  } catch (error) {
    return promotionFailure("createPromotion", error) as ActionResult<{ id: string }>;
  }
}

/**
 * Update a promotion. Order items froze their snapshots at creation, so
 * edits never rewrite history.
 */
export async function updatePromotionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = promotionFormSchema
    .extend({ id: z.string().uuid("Invalid promotion.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid promotion details." };
  }
  try {
    await updatePromotion({
      id: parsed.data.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      type: parsed.data.type,
      value: parsed.data.value,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      isActive: parsed.data.isActive,
    });
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    return promotionFailure("updatePromotion", error) as ActionResult<{ id: string }>;
  }
}

/** Activate/deactivate. Live pricing reads the flag; history untouched. */
export async function setPromotionActiveAction(
  input: unknown,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid("Invalid promotion."), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid promotion." };
  try {
    await setPromotionActive(parsed.data.id, parsed.data.isActive);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return promotionFailure("setPromotionActive", error) as ActionResult<{
      id: string;
      isActive: boolean;
    }>;
  }
}

/** Map a product (duplicate mappings rejected as domain conflicts). */
export async function mapProductAction(
  input: unknown,
): Promise<ActionResult<{ promotionId: string; productId: string }>> {
  await requireAdmin();
  const parsed = z
    .object({
      promotionId: z.string().uuid("Invalid promotion."),
      productId: z.string().uuid("Invalid product."),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product mapping." };
  try {
    await mapProductToPromotion(parsed.data.promotionId, parsed.data.productId);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return promotionFailure("mapProduct", error) as ActionResult<{
      promotionId: string;
      productId: string;
    }>;
  }
}

/** Remove a mapping. Paged prices refresh via invalidation; history frozen. */
export async function unmapProductAction(
  input: unknown,
): Promise<ActionResult<{ promotionId: string; productId: string }>> {
  await requireAdmin();
  const parsed = z
    .object({
      promotionId: z.string().uuid("Invalid promotion."),
      productId: z.string().uuid("Invalid product."),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product mapping." };
  try {
    await unmapProductFromPromotion(parsed.data.promotionId, parsed.data.productId);
    return { ok: true, data: parsed.data };
  } catch (error) {
    return promotionFailure("unmapProduct", error) as ActionResult<{
      promotionId: string;
      productId: string;
    }>;
  }
}

/** Product picker search for mappings (admin-gated, names only). */
export async function searchProductsForMappingAction(
  input: unknown,
): Promise<ActionResult<ProductSearchRow[]>> {
  await requireAdmin();
  const parsed = z
    .object({ promotionId: z.string().uuid(), query: z.string().max(120) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };
  const rows = await searchProductsForMapping(parsed.data.promotionId, parsed.data.query);
  return { ok: true, data: rows };
}
