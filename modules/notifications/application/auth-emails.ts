import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { authEmails } from "@/infrastructure/database/schema";
import { sendMail } from "@/shared/lib/mail";
import { logger } from "@/shared/lib/logging/logger";
import {
  computeBackoffMs,
  sanitizeProviderError,
} from "@/modules/notifications/application/backoff";

/**
 * Durable queue for Better Auth verification / password-reset emails
 * (GP-14 / T-3.3, migration 0034). The rendered email is stored at enqueue
 * time; sending is the same claim/lease/once machine the order-retry worker
 * runs: CAS QUEUED -> SENDING before the SMTP call, SENT only after the
 * provider accepts, bounded backoff on failure, FAILED at exhaustion (the
 * retry worker owns that path).
 */
export const AUTH_EMAIL_TYPES = ["VERIFICATION", "PASSWORD_RESET"] as const;
export type AuthEmailType = (typeof AUTH_EMAIL_TYPES)[number];

export interface AuthEmailInput {
  userId: string;
  eventType: AuthEmailType;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/**
 * Insert the queued row. Returns null when the row cannot be persisted —
 * the only expected case is the account vanishing between the auth flow and
 * this insert (FK cascade target gone). Never throws at the caller: an
 * email hiccup must not abort an auth request (same envelope as the
 * state-transition callers of order emails).
 */
export async function enqueueAuthEmail(input: AuthEmailInput): Promise<string | null> {
  try {
    const [row] = await db
      .insert(authEmails)
      .values({
        userId: input.userId,
        eventType: input.eventType,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
      })
      .returning({ id: authEmails.id });
    return row?.id ?? null;
  } catch (error) {
    logger.error("Auth email enqueue failed", {
      module: "notifications",
      action: "authEmailEnqueueFailed",
      eventType: input.eventType,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

/**
 * CAS QUEUED -> SENDING before the SMTP call. Identical semantics to
 * `startNotificationDispatch`: a retry worker winning between enqueue and
 * this CAS suppresses our attempt (no duplicate), and a crash here leaves a
 * lease the worker reaps at expiry.
 */
async function startAuthEmailDispatch(id: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    UPDATE auth_emails
    SET status = 'SENDING', updated_at = now()
    WHERE id = ${id}
      AND status = 'QUEUED'
    RETURNING id
  `)) as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * One send attempt for one queued row. Returns whether the caller (the auth
 * hook / retry worker) should treat it as delivered or leave it to backoff.
 * An SMTP failure schedules a bounded retry; nothing ever throws.
 */
export async function dispatchAuthEmail(id: string): Promise<{ sent: boolean; reason?: string }> {
  const leased = await startAuthEmailDispatch(id);
  if (!leased) return { sent: false, reason: "not-claimed" };

  const [row] = await db
    .select({
      eventType: authEmails.eventType,
      recipientEmail: authEmails.recipientEmail,
      subject: authEmails.subject,
      bodyHtml: authEmails.bodyHtml,
      bodyText: authEmails.bodyText,
    })
    .from(authEmails)
    .where(and(eq(authEmails.id, id)));

  if (!row) return { sent: false, reason: "row-missing" };

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
      .where(eq(authEmails.id, id));
    return { sent: true };
  } catch (error) {
    const [current] = await db
      .select({ attempts: authEmails.attempts })
      .from(authEmails)
      .where(eq(authEmails.id, id));
    const attempts = (current?.attempts ?? 0) + 1;
    await db
      .update(authEmails)
      .set({
        status: "QUEUED",
        attempts,
        nextRetryAt: new Date(Date.now() + computeBackoffMs(attempts)),
        lastError: sanitizeProviderError(error),
        updatedAt: new Date(),
      })
      .where(eq(authEmails.id, id));
    logger.error("Auth email send failed", {
      module: "notifications",
      action: "authEmailSendFailed",
      authEmailId: id,
      eventType: row.eventType,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { sent: false, reason: "provider-error" };
  }
}
