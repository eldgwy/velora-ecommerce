import { and, eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { banners } from "@/infrastructure/database/schema/marketing";
import {
  assertBannerLink,
  assertBannerSubtitle,
  assertBannerTitle,
  assertBannerWindow,
  assertDesktopImage,
  assertMobileImage,
  assertSortOrder,
  canTransitionBannerStatus,
  type BannerStatus,
} from "@/modules/banners/domain/banner-rules";
import {
  BannerNotFoundError,
  BannerValidationError,
} from "@/modules/banners/domain/banner-errors";
import { invalidateBannerCache } from "@/shared/lib/cache/tags";
import { logger } from "@/shared/lib/logging/logger";

export interface BannerTermsInput {
  title: string;
  subtitle?: string | null;
  image: string;
  mobileImage?: string | null;
  link?: string | null;
  sortOrder?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  status?: BannerStatus;
}

function validateTerms(input: BannerTermsInput) {
  const title = assertBannerTitle(input.title);
  const subtitle = assertBannerSubtitle(input.subtitle);
  const image = assertDesktopImage(input.image);
  const mobileImage = assertMobileImage(input.mobileImage);
  const link = assertBannerLink(input.link);
  const sortOrder = assertSortOrder(input.sortOrder);
  const startsAt = input.startsAt ?? null;
  const endsAt = input.endsAt ?? null;
  assertBannerWindow(startsAt, endsAt);
  const status = input.status ?? "DRAFT";
  if (status !== "ACTIVE" && status !== "EXPIRED" && status !== "SCHEDULED" && status !== "DRAFT") {
    throw new BannerValidationError("Banner status is invalid.");
  }
  return { title, subtitle, image, mobileImage, link, sortOrder, startsAt, endsAt, status };
}

async function invalidateBanner(id: string): Promise<void> {
  try {
    await invalidateBannerCache(id);
  } catch (error) {
    // Commands also run outside Server Actions (tests, scripts, jobs)
    // where tag invalidation is unavailable; the time-based revalidate
    // window bounds staleness there. Anything else is a real failure.
    if (error instanceof Error && /Server Action/.test(error.message)) return;
    throw error;
  }
}

/**
 * Create a banner. Starts DRAFT unless requested — nothing is public
 * without explicit publication intent.
 */
export async function createBanner(input: BannerTermsInput): Promise<{ id: string }> {
  const terms = validateTerms(input);
  const [created] = await db
    .insert(banners)
    .values({
      title: terms.title,
      subtitle: terms.subtitle,
      image: terms.image,
      mobileImage: terms.mobileImage,
      link: terms.link,
      sortOrder: terms.sortOrder,
      startsAt: terms.startsAt,
      endsAt: terms.endsAt,
      status: terms.status,
    })
    .returning({ id: banners.id });
  if (!created) throw new Error("Banner insert failed");
  logger.info("Banner created", {
    module: "banners",
    action: "bannerCreated",
    bannerId: created.id,
  });
  await invalidateBanner(created.id);
  return { id: created.id };
}

export interface BannerUpdateInput extends BannerTermsInput {
  id: string;
}

/**
 * Update content, images, link, schedule, and status. Editing never
 * publishes implicitly: moving out of DRAFT requires the status field to
 * say so, validated against the transition matrix.
 */
export async function updateBanner(input: BannerUpdateInput): Promise<void> {
  const terms = validateTerms(input);
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: banners.id, status: banners.status })
      .from(banners)
      .where(eq(banners.id, input.id))
      .for("update");
    if (!current) throw new BannerNotFoundError(input.id);
    if (!canTransitionBannerStatus(current.status as BannerStatus, terms.status)) {
      throw new BannerValidationError(
        `Banner cannot move from ${current.status} to ${terms.status}.`,
      );
    }
    const [row] = await tx
      .update(banners)
      .set({
        title: terms.title,
        subtitle: terms.subtitle,
        image: terms.image,
        mobileImage: terms.mobileImage,
        link: terms.link,
        sortOrder: terms.sortOrder,
        startsAt: terms.startsAt,
        endsAt: terms.endsAt,
        status: terms.status,
        updatedAt: new Date(),
      })
      .where(eq(banners.id, input.id))
      .returning({ id: banners.id });
    return row;
  });
  if (!updated) throw new Error("Banner update failed");
  logger.info("Banner updated", {
    module: "banners",
    action: "bannerUpdated",
    bannerId: input.id,
  });
  await invalidateBanner(input.id);
}

/** Delete a banner (admin lifecycle: no orders reference banners). */
export async function deleteBanner(id: string): Promise<void> {
  const deleted = await db
    .delete(banners)
    .where(eq(banners.id, id))
    .returning({ id: banners.id });
  if (deleted.length === 0) throw new BannerNotFoundError(id);
  logger.info("Banner deleted", {
    module: "banners",
    action: "bannerDeleted",
    bannerId: id,
  });
  await invalidateBanner(id);
}

/**
 * Persist an explicit display order from an ordered id array. The array
 * must contain each id exactly once; positions write densely 0..n-1 in one
 * transaction, so order can never duplicate or gap.
 */
export async function reorderBanners(orderedIds: string[]): Promise<void> {
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) {
    throw new BannerValidationError("Display order contains a duplicated banner.");
  }
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: banners.id }).from(banners);
    const existingSet = new Set(existing.map((r) => r.id));
    if (unique.size !== existingSet.size || ![...unique].every((id) => existingSet.has(id))) {
      throw new BannerValidationError(
        "Display order must contain exactly the current banner set.",
      );
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(banners)
        .set({ sortOrder: index, updatedAt: new Date() })
        .where(eq(banners.id, id));
    }
  });
  for (const id of orderedIds) {
    await invalidateBanner(id);
  }
}

/**
 * Status-only transition (publish/unpublish/withdraw) with matrix
 * validation under a row lock.
 */
export async function transitionBannerStatus(
  id: string,
  to: BannerStatus,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: banners.id, status: banners.status })
      .from(banners)
      .where(eq(banners.id, id))
      .for("update");
    if (!current) throw new BannerNotFoundError(id);
    if (!canTransitionBannerStatus(current.status as BannerStatus, to)) {
      throw new BannerValidationError(
        `Banner cannot move from ${current.status} to ${to}.`,
      );
    }
    if (current.status === to) return;
    await tx
      .update(banners)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(banners.id, id), eq(banners.status, current.status)));
  });
  logger.info("Banner status changed", {
    module: "banners",
    action: "bannerStatusChanged",
    bannerId: id,
    actorId,
  });
  await invalidateBanner(id);
}
