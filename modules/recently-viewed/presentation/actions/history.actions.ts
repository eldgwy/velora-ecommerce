"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentSession } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  clearHistory,
  mergeGuestHistory,
  recordProductView,
  removeHistoryEntry,
  ProductNotViewableError,
} from "@/modules/recently-viewed/application/commands/history";
import {
  resolveGuestHistory,
  type RecentViewItem,
} from "@/modules/recently-viewed/application/queries/history";
import { parseGuestHistory } from "@/modules/recently-viewed/domain/history-rules";

const HISTORY_PATH = "/account/recently-viewed";

const productSchema = z.object({ productId: z.string().uuid("Invalid product.") });

function logFailure(action: string, error: unknown, userId?: string): void {
  logger.error(`Recently-viewed action failed: ${action}`, {
    module: "recently-viewed",
    action,
    userId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

/** Record the current product view (authenticated callers only). */
export async function recordViewAction(input: unknown): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "Not signed in." };
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product." };
  try {
    await recordProductView(session.user.id, parsed.data.productId);
    return { ok: true, data: undefined };
  } catch (error) {
    // Ineligible products are routine (archived mid-browse); tracking
    // failures must never break the product page.
    if (error instanceof ProductNotViewableError) return { ok: false, error: "Not recorded." };
    logFailure("recordView", error, session.user.id);
    return { ok: false, error: "Not recorded." };
  }
}

/** Remove one entry from the caller's history. */
export async function removeHistoryEntryAction(
  input: unknown,
): Promise<ActionResult<{ removed: boolean }>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product." };
  const { removed } = await removeHistoryEntry(session.user.id, parsed.data.productId);
  revalidatePath(HISTORY_PATH);
  return { ok: true, data: { removed } };
}

/** Clear the caller's history. */
export async function clearHistoryAction(): Promise<ActionResult<{ cleared: number }>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const { cleared } = await clearHistory(session.user.id);
  revalidatePath(HISTORY_PATH);
  return { ok: true, data: { cleared } };
}

const guestEntrySchema = z.object({ id: z.string(), at: z.number() });

/**
 * Merge browser-local guest entries into the account history after
 * sign-in. Every id is re-validated server-side; unknown ids drop out.
 * Idempotent — safe to repeat after app updates or retries.
 */
export async function mergeGuestHistoryAction(
  input: unknown,
): Promise<ActionResult<{ merged: number }>> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "You must be signed in." };
  const parsed = z.array(guestEntrySchema).max(100).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid history." };
  const entries = parseGuestHistory(parsed.data);
  const { merged } = await mergeGuestHistory(
    session.user.id,
    entries.map((e) => ({ id: e.id, at: e.at })),
  );
  if (merged > 0) revalidatePath(HISTORY_PATH);
  return { ok: true, data: { merged } };
}

/**
 * Resolve guest ids to live product cards. Public catalog data only —
 * stored metadata is never trusted. Malformed ids drop out silently.
 */
export async function resolveGuestHistoryAction(
  input: unknown,
): Promise<ActionResult<{ items: RecentViewItem[] }>> {
  const parsed = z.array(z.string()).max(100).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid history." };
  const entries = parseGuestHistory(parsed.data.map((id) => ({ id, at: 0 })));
  const items = await resolveGuestHistory(entries.map((e) => e.id));
  return { ok: true, data: { items } };
}
