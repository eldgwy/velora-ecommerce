import { and, eq, lte, or, sql, isNull } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { authEmails } from "@/infrastructure/database/schema";
import { sendMail } from "@/shared/lib/mail";
import { logger } from "@/shared/lib/logging/logger";
import {
  computeBackoffMs,
  retryConfigFromEnv,
  sanitizeProviderError,
} from "@/modules/notifications/application/backoff";
import type { AuthEmailType } from "@/modules/notifications/application/auth-emails";

/**
 * Auth-email retry worker (GP-14 / T-3.3). Identical mechanics to the
 * order-notification retry worker `modules/jobs/notification-retry.ts`:
 * atomic due-scan (QUEUED due-or-immediate, or SENDING whose lease expired),
 * single CAS claim per row, bounded attempts with backoff, FAILED at
 * exhaustion, SMTP outside every DB transaction. Rows replay the email
 * stored at enqueue time — a reset link's 60-minute token comfortably
 * covers the backoff window; a replay after expiry is simply rejected by
 * Better Auth and the user can request a fresh link.
 *
 * Attempt accounting note: the enqueue-path send (hook) does not increment
 * `attempts` (the row's first attempt); each worker claim does, matching
 * the order-retry worker exactly.
 */
export interface AuthEmailJobConfig {
  batchSize: number;
  maxAttempts: number;
  leaseMs: number;
}

export function defaultAuthEmailJobConfig(): AuthEmailJobConfig {
  const env = retryConfigFromEnv();
  return { batchSize: env.batchSize, maxAttempts: env.maxAttempts, leaseMs: env.leaseMs };
}

export interface AuthEmailRetryResult {
  authEmailId: string;
  eventType: string;
  outcome: "sent" | "scheduled" | "failed" | "skipped";
}

export interface AuthEmailJobRunResult {
  due: number;
  sent: number;
  scheduled: number;
  failed: number;
  skipped: number;
  results: AuthEmailRetryResult[];
  durationMs: number;
}

interface DueRow {
  id: string;
  eventType: AuthEmailType;
  attempts: number;
}

/**
 * Atomically claim one row for this worker: only QUEUED rows whose retry is
 * due (nextRetryAt null or passed), or SENDING rows whose lease expired (a
 * crashed worker). The single UPDATE...RETURNING serializes concurrent
 * workers — exactly one wins each row.
 */
async function claimDueRow(authEmailId: string, leaseCutoff: Date): Promise<DueRow | null> {
  const rows = (await db.execute(sql`
    UPDATE auth_emails
    SET status = 'SENDING',
        attempts = attempts + 1,
        updated_at = now()
    WHERE id = ${authEmailId}
      AND (
        status = 'QUEUED'
        OR (status = 'SENDING' AND updated_at < ${leaseCutoff.toISOString()})
      )
    RETURNING id, event_type AS "eventType", attempts
  `)) as unknown as Array<DueRow>;
  return rows[0] ?? null;
}

async function findDueAuthEmails(limit: number, leaseMs: number): Promise<DueRow[]> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - leaseMs);
  return db
    .select({
      id: authEmails.id,
      eventType: authEmails.eventType,
      attempts: authEmails.attempts,
    })
    .from(authEmails)
    .where(
      and(
        or(
          and(
            eq(authEmails.status, "QUEUED"),
            or(
              isNull(authEmails.nextRetryAt),
              lte(authEmails.nextRetryAt, now),
            ),
          ),
          and(
            eq(authEmails.status, "SENDING"),
            lte(authEmails.updatedAt, leaseCutoff),
          ),
        ),
      ),
    )
    .orderBy(authEmails.nextRetryAt)
    .limit(limit) as unknown as DueRow[];
}

/**
 * Process one auth email end-to-end. SMTP stays outside every database
 * transaction; the claim and the outcome write are separate short
 * transactions, so a crash always leaves either a lease to reap or a
 * scheduled retry. The email body is replayed from the row.
 */
export async function processAuthEmailRetry(
  authEmailId: string,
  config: Partial<AuthEmailJobConfig> = {},
): Promise<AuthEmailRetryResult> {
  const { maxAttempts, leaseMs } = { ...defaultAuthEmailJobConfig(), ...config };
  const leaseCutoff = new Date(Date.now() - leaseMs);

  const claimed = await claimDueRow(authEmailId, leaseCutoff);
  if (!claimed) {
    return { authEmailId, eventType: "", outcome: "skipped" };
  }

  const [row] = await db
    .select({
      recipientEmail: authEmails.recipientEmail,
      subject: authEmails.subject,
      bodyHtml: authEmails.bodyHtml,
      bodyText: authEmails.bodyText,
    })
    .from(authEmails)
    .where(eq(authEmails.id, claimed.id));

  let outcome: AuthEmailRetryResult["outcome"];
  if (!row) {
    // Claimed row lost its recipient body (should not happen with NOT NULL
    // columns): park as failed with a safe note.
    await db
      .update(authEmails)
      .set({
        status: "FAILED",
        lastError: "auth email body missing",
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(eq(authEmails.id, claimed.id));
    outcome = "failed";
  } else {
    try {
      const info = await sendMail({
        to: row.recipientEmail,
        subject: row.subject,
        html: row.bodyHtml,
        text: row.bodyText,
      });
      await db
        .update(authEmails)
        .set({
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: (info as { messageId?: string } | undefined)?.messageId ?? null,
          lastError: null,
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(authEmails.id, claimed.id));
      outcome = "sent";
    } catch (error) {
      if (claimed.attempts >= maxAttempts) {
        await db
          .update(authEmails)
          .set({
            status: "FAILED",
            lastError: sanitizeProviderError(error),
            nextRetryAt: null,
            updatedAt: new Date(),
          })
          .where(eq(authEmails.id, claimed.id));
        logger.error("Auth email retries exhausted", {
          module: "jobs",
          action: "authEmailRetryExhausted",
          authEmailId: claimed.id,
          eventType: claimed.eventType,
          attempts: claimed.attempts,
        });
        outcome = "failed";
      } else {
        await db
          .update(authEmails)
          .set({
            status: "QUEUED",
            lastError: sanitizeProviderError(error),
            nextRetryAt: new Date(Date.now() + computeBackoffMs(claimed.attempts)),
            updatedAt: new Date(),
          })
          .where(eq(authEmails.id, claimed.id));
        outcome = "scheduled";
      }
    }
  }

  return { authEmailId: claimed.id, eventType: claimed.eventType, outcome };
}

export async function processAuthEmailRetries(
  config: Partial<AuthEmailJobConfig> = {},
): Promise<AuthEmailJobRunResult> {
  const full = { ...defaultAuthEmailJobConfig(), ...config };
  const startTime = Date.now();
  const runId = `auth-email-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.info("Starting auth email retry job", {
    module: "jobs",
    action: "processAuthEmailRetries",
    runId,
    batchSize: full.batchSize,
  });

  const due = await findDueAuthEmails(full.batchSize, full.leaseMs);
  const results: AuthEmailRetryResult[] = [];

  for (const row of due) {
    results.push(await processAuthEmailRetry(row.id, full));
  }

  const sent = results.filter((r) => r.outcome === "sent").length;
  const scheduled = results.filter((r) => r.outcome === "scheduled").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const durationMs = Date.now() - startTime;

  logger.info("Auth email retry job completed", {
    module: "jobs",
    action: "processAuthEmailRetries",
    runId,
    due: due.length,
    sent,
    scheduled,
    failed,
    skipped,
    durationMs,
  });

  return { due: due.length, sent, scheduled, failed, skipped, results, durationMs };
}

/**
 * Internal API handler, protected by the same CRON_SECRET bearer pattern as
 * the other job endpoints.
 */
export async function handleAuthEmailRetryRequest(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized attempt to access auth email retry endpoint", {
      module: "jobs",
      action: "handleAuthEmailRetryRequest",
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await processAuthEmailRetries();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    logger.error("Auth email retry job failed", {
      module: "jobs",
      action: "handleAuthEmailRetryRequest",
      error: errorMessage,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
