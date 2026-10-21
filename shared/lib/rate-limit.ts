import { sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { rateLimit } from "@/infrastructure/database/schema/rate-limit";
import { logger } from "@/shared/lib/logging/logger";

/**
 * Per-actor rate limiting for server actions (GP-15 / T-2.9).
 *
 * Reuses Better Auth's PostgreSQL `rate_limit` table (same storage backend
 * the auth layer already runs on): keys are namespaced with the action scope
 * so they cannot collide with Better Auth's own auth-endpoint keys, and the
 * same window semantics apply — a counter starts a new window whenever the
 * previous `last_request` falls outside `window` seconds.
 *
 * The upsert is atomic (unique key + ON CONFLICT), so concurrent submissions
 * of the same actor can never race past the limit.
 *
 * Fail-open: an infrastructure error must not lock customers out of
 * non-money-adjacent UGC; the failure is logged loudly instead.
 */
export interface RateLimitRule {
  /** Window length in seconds, matching the Better Auth table semantics. */
  window: number;
  /** Maximum allowed attempts per window (inclusive). */
  max: number;
}

/** Product decision D14: conservative UGC throttle values. */
export const UGC_RATE_LIMITS = {
  reviewSubmit: { window: 600, max: 5 } satisfies RateLimitRule,
  questionSubmit: { window: 600, max: 5 } satisfies RateLimitRule,
  reviewUploadParams: { window: 3600, max: 30 } satisfies RateLimitRule,
} as const;

/**
 * Consume one attempt for `scope:identifier`. Returns true when the attempt
 * is allowed (counter within `max`), false when throttled.
 */
export async function consumeRateLimit(
  scope: string,
  identifier: string,
  rule: RateLimitRule,
): Promise<boolean> {
  const key = `${scope}:${identifier}`;
  const now = Date.now();
  const windowStartMs = now - rule.window * 1000;

  try {
    const [row] = await db
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key,
        count: 1,
        lastRequest: now,
      })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          // Within the window: increment; otherwise open a fresh window. The
          // ON CONFLICT SET clause may legally reference the target table's
          // current row columns in PostgreSQL.
          count: sql`case when ${rateLimit.lastRequest} > ${windowStartMs} then ${rateLimit.count} + 1 else 1 end`,
          lastRequest: now,
        },
      })
      .returning({ count: rateLimit.count });

    return (row?.count ?? 1) <= rule.max;
  } catch (error) {
    logger.error("Rate limiter failure — failing open", {
      module: "rate-limit",
      action: "consume",
      scope,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return true;
  }
}
