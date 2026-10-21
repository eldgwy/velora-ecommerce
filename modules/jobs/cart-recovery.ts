import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { cartRecoveryEmails } from "@/infrastructure/database/schema";
import {
  scanAndEnqueueAbandonedCarts,
  type CartRecoveryScanConfig,
} from "@/modules/notifications/application/cart-recovery-emails";
import { sendMail } from "@/shared/lib/mail";
import { logger } from "@/shared/lib/logging/logger";
import {
  computeBackoffMs,
  retryConfigFromEnv,
  sanitizeProviderError,
} from "@/modules/notifications/application/backoff";

/**
 * Cart-recovery job (T-5.1). Every invocation does BOTH halves:
 * 1. scan — ACTIVE carts idle past their stage delay with an unclaimed
 *    (cart_id, stage) slot enqueue the next reminder (unique-index guarded,
 *    idempotent, frequency-capped per user);
 * 2. retry — queued rows whose backoff came due (or whose lease expired)
 *    are claimed by a single CAS and delivered; exhaustion parks FAILED.
 *
 * Attempt accounting matches the auth-email queue: the enqueue does not
 * bump `attempts`; each worker claim does.
 */
export interface CartRecoveryJobConfig {
  batchSize: number;
  maxAttempts: number;
  leaseMs: number;
}

export function defaultCartRecoveryJobConfig(): CartRecoveryJobConfig {
  const env = retryConfigFromEnv();
  return { batchSize: env.batchSize, maxAttempts: env.maxAttempts, leaseMs: env.leaseMs };
}

export interface CartRecoveryRunResult {
  scan: Awaited<ReturnType<typeof scanAndEnqueueAbandonedCarts>>;
  due: number;
  sent: number;
  scheduled: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

interface DueRow {
  id: string;
  stage: number;
  attempts: number;
}

/**
 * Atomic claim: QUEUED-due or expired SENDING lease. One winner per row.
 * The lease cutoff is CLIENT-clock (matching every updatedAt write, all
 * client-stamped), and the attempt bump happens atomically with the
 * SENDING transition — RETURNING reports the incremented value.
 */
async function claimDueRow(id: string, leaseCutoff: Date): Promise<DueRow | null> {
  const rows = await db
    .update(cartRecoveryEmails)
    .set({
      status: "SENDING",
      attempts: sql`${cartRecoveryEmails.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cartRecoveryEmails.id, id),
        or(
          eq(cartRecoveryEmails.status, "QUEUED"),
          and(eq(cartRecoveryEmails.status, "SENDING"), lte(cartRecoveryEmails.updatedAt, leaseCutoff)),
        ),
      ),
    )
    .returning({
      id: cartRecoveryEmails.id,
      stage: cartRecoveryEmails.stage,
      attempts: cartRecoveryEmails.attempts,
    });
  const claimed = rows.find((r) => r.id === id) ?? null;
  return claimed ? { id: claimed.id, stage: claimed.stage, attempts: claimed.attempts } : null;
}

async function findDueRows(limit: number, leaseMs: number): Promise<DueRow[]> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - leaseMs);
  return db
    .select({
      id: cartRecoveryEmails.id,
      stage: cartRecoveryEmails.stage,
      attempts: cartRecoveryEmails.attempts,
    })
    .from(cartRecoveryEmails)
    .where(
      or(
        and(
          eq(cartRecoveryEmails.status, "QUEUED"),
          or(isNull(cartRecoveryEmails.nextRetryAt), lte(cartRecoveryEmails.nextRetryAt, now)),
        ),
        and(eq(cartRecoveryEmails.status, "SENDING"), lte(cartRecoveryEmails.updatedAt, leaseCutoff)),
      ),
    )
    .orderBy(cartRecoveryEmails.nextRetryAt)
    .limit(limit) as unknown as DueRow[];
}

async function processRow(
  id: string,
  config: CartRecoveryJobConfig,
): Promise<"sent" | "scheduled" | "failed" | "skipped"> {
  const { maxAttempts, leaseMs } = config;
  const claimed = await claimDueRow(id, new Date(Date.now() - leaseMs));
  if (!claimed) return "skipped";

  const [row] = await db
    .select({
      recipientEmail: cartRecoveryEmails.recipientEmail,
      subject: cartRecoveryEmails.subject,
      bodyHtml: cartRecoveryEmails.bodyHtml,
      bodyText: cartRecoveryEmails.bodyText,
    })
    .from(cartRecoveryEmails)
    .where(eq(cartRecoveryEmails.id, claimed.id));

  if (!row) {
    // NOT NULL columns make this unreachable today; park as failed loudly.
    await db
      .update(cartRecoveryEmails)
      .set({ status: "FAILED", lastError: "recovery email body missing", nextRetryAt: null, updatedAt: new Date() })
      .where(eq(cartRecoveryEmails.id, claimed.id));
    return "failed";
  }

  try {
    await sendMail({ to: row.recipientEmail, subject: row.subject, html: row.bodyHtml, text: row.bodyText });
    await db
      .update(cartRecoveryEmails)
      .set({ status: "SENT", sentAt: new Date(), lastError: null, nextRetryAt: null, updatedAt: new Date() })
      .where(eq(cartRecoveryEmails.id, claimed.id));
    return "sent";
  } catch (error) {
    if (claimed.attempts >= maxAttempts) {
      await db
        .update(cartRecoveryEmails)
        .set({ status: "FAILED", lastError: sanitizeProviderError(error), nextRetryAt: null, updatedAt: new Date() })
        .where(eq(cartRecoveryEmails.id, claimed.id));
      logger.error("Cart recovery retries exhausted", {
        module: "jobs",
        action: "cartRecoveryExhausted",
        cartRecoveryEmailId: claimed.id,
        stage: claimed.stage,
        attempts: claimed.attempts,
      });
      return "failed";
    }
    await db
      .update(cartRecoveryEmails)
      .set({
        status: "QUEUED",
        lastError: sanitizeProviderError(error),
        nextRetryAt: new Date(Date.now() + computeBackoffMs(claimed.attempts)),
        updatedAt: new Date(),
      })
      .where(eq(cartRecoveryEmails.id, claimed.id));
    return "scheduled";
  }
}

export async function processCartRecoveryRun(
  scanConfigPartial: Partial<CartRecoveryScanConfig> = {},
  jobConfigPartial: Partial<CartRecoveryJobConfig> = {},
): Promise<CartRecoveryRunResult> {
  const fullJob = { ...defaultCartRecoveryJobConfig(), ...jobConfigPartial };
  const startTime = Date.now();

  const scan = await scanAndEnqueueAbandonedCarts(scanConfigPartial);

  const due = await findDueRows(fullJob.batchSize, fullJob.leaseMs);
  let sent = 0;
  let scheduled = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of due) {
    const outcome = await processRow(row.id, fullJob);
    switch (outcome) {
      case "sent": sent += 1; break;
      case "scheduled": scheduled += 1; break;
      case "failed": failed += 1; break;
      default: skipped += 1;
    }
  }

  return {
    scan,
    due: due.length,
    sent,
    scheduled,
    failed,
    skipped,
    durationMs: Date.now() - startTime,
  };
}

export async function handleCartRecoveryRequest(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized attempt to access cart recovery endpoint", {
      module: "jobs",
      action: "handleCartRecoveryRequest",
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await processCartRecoveryRun();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    logger.error("Cart recovery job failed", {
      module: "jobs",
      action: "handleCartRecoveryRequest",
      error: errorMessage,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
