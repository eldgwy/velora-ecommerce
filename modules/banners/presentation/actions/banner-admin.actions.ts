"use server";

import { z } from "zod";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  createBanner,
  deleteBanner,
  reorderBanners,
  transitionBannerStatus,
  updateBanner,
} from "@/modules/banners/application/commands/banners";
import {
  getEligibleBanners,
  listBanners,
  type BannerList,
  type PublicBanner,
} from "@/modules/banners/application/queries/banners";
import {
  BannerNotFoundError,
  BannerValidationError,
} from "@/modules/banners/domain/banner-errors";

const optionalDate = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v !== "string") return v;
  // `datetime-local` inputs carry no zone; interpret them as UTC so stored
  // walls match the repository's UTC convention regardless of server locale.
  const m = v.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if (m) return new Date(`${m[1]}${m[2] ?? ":00"}Z`);
  return v;
}, z.coerce.date().optional());

const bannerFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  subtitle: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().max(300).optional(),
    ),
  image: z.string().trim().min(1, "Desktop image is required."),
  mobileImage: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().max(2048).optional(),
    ),
  link: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().trim().max(2048).optional(),
    ),
  sortOrder: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).max(9999).optional(),
  ),
  startsAt: optionalDate,
  endsAt: optionalDate,
  status: z.enum(["ACTIVE", "EXPIRED", "SCHEDULED", "DRAFT"]).optional().default("DRAFT"),
});

const listSchema = z.object({
  query: z.string().max(120).optional(),
  status: z.enum(["ACTIVE", "EXPIRED", "SCHEDULED", "DRAFT"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function bannerFailure(action: string, error: unknown): ActionResult<never> {
  if (error instanceof BannerNotFoundError || error instanceof BannerValidationError) {
    return { ok: false, error: error.message };
  }
  logger.error(`Banner admin action failed: ${action}`, {
    module: "banners",
    action,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "That banner action could not be completed." };
}

/** Paginated banner list (admin-gated). */
export async function listBannersAction(input: unknown): Promise<ActionResult<BannerList>> {
  await requireAdmin();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters." };
  }
  const result = await listBanners({
    query: parsed.data.query,
    status: parsed.data.status,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  return { ok: true, data: result };
}

/** Create a banner (admin-gated). Starts DRAFT unless published explicitly. */
export async function createBannerAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = bannerFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid banner details." };
  }
  try {
    const result = await createBanner({
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? null,
      image: parsed.data.image,
      mobileImage: parsed.data.mobileImage ?? null,
      link: parsed.data.link ?? null,
      sortOrder: parsed.data.sortOrder ?? null,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      status: parsed.data.status,
    });
    return { ok: true, data: result };
  } catch (error) {
    return bannerFailure("createBanner", error) as ActionResult<{ id: string }>;
  }
}

/** Update a banner (admin-gated). Publishing is always an explicit choice. */
export async function updateBannerAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = bannerFormSchema
    .extend({ id: z.string().uuid("Invalid banner.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid banner details." };
  }
  try {
    await updateBanner({
      id: parsed.data.id,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle ?? null,
      image: parsed.data.image,
      mobileImage: parsed.data.mobileImage ?? null,
      link: parsed.data.link ?? null,
      sortOrder: parsed.data.sortOrder ?? null,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      status: parsed.data.status,
    });
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    return bannerFailure("updateBanner", error) as ActionResult<{ id: string }>;
  }
}

/** Delete a banner (admin-gated). Nothing references banners. */
export async function deleteBannerAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = z.string().uuid("Invalid banner.").safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid banner." };
  try {
    await deleteBanner(parsed.data);
    return { ok: true, data: { id: parsed.data } };
  } catch (error) {
    return bannerFailure("deleteBanner", error) as ActionResult<{ id: string }>;
  }
}

/** Status-only transition with matrix validation (admin-gated). */
export async function transitionBannerStatusAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireAdmin();
  const parsed = z
    .object({
      id: z.string().uuid("Invalid banner."),
      to: z.enum(["ACTIVE", "EXPIRED", "SCHEDULED", "DRAFT"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid banner transition." };
  try {
    await transitionBannerStatus(parsed.data.id, parsed.data.to, session.user.id);
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    return bannerFailure("transitionBannerStatus", error) as ActionResult<{ id: string }>;
  }
}

/** Persist an explicit display order (admin-gated). */
export async function reorderBannersAction(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
  await requireAdmin();
  const parsed = z
    .object({ orderedIds: z.array(z.string().uuid()).min(1).max(500) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid display order." };
  try {
    await reorderBanners(parsed.data.orderedIds);
    return { ok: true, data: { count: parsed.data.orderedIds.length } };
  } catch (error) {
    return bannerFailure("reorderBanners", error) as ActionResult<{ count: number }>;
  }
}

/**
 * Eligible banners for the public carousel. No session required —
 * eligibility is enforced in the query (ACTIVE + window + order).
 */
export async function getEligibleBannersAction(): Promise<
  ActionResult<{ items: PublicBanner[] }>
> {
  const items = await getEligibleBanners(new Date());
  return { ok: true, data: { items } };
}

/**
 * Signed Cloudinary params for banner cover uploads. Scoped to the banner
 * folder; recording the URL still goes through the validated
 * create/update actions.
 */
export async function getBannerCoverUploadParamsAction(input: unknown): Promise<
  ActionResult<{ params: {
    timestamp: number;
    signature: string;
    apiKey: string;
    cloudName: string;
    folder: string;
    uploadPreset?: string;
  } }>
> {
  await requireAdmin();
  const parsed = z
    .object({ bannerId: z.string().uuid().optional() })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid upload request." };
  const { createSignedUploadParams } = await import("@/infrastructure/cloudinary/client");
  const params = createSignedUploadParams({
    folder: `velora/banners/${parsed.data.bannerId ?? "new"}`,
    tags: parsed.data.bannerId ? [parsed.data.bannerId] : [],
  });
  return { ok: true, data: { params } };
}

/** Single banner for editing (admin-gated). */
export async function getBannerDetailAction(
  input: unknown,
): Promise<ActionResult<import("@/modules/banners/application/queries/banners").BannerListItem>> {
  await requireAdmin();
  const parsed = z.string().uuid("Invalid banner.").safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid banner." };
  const { getBannerDetail } = await import(
    "@/modules/banners/application/queries/banners"
  );
  const detail = await getBannerDetail(parsed.data);
  if (!detail) return { ok: false, error: "Banner not found." };
  return { ok: true, data: detail };
}
