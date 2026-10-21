import { and, eq, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { cartRecoveryEmails } from "@/infrastructure/database/schema";
import { env } from "@/config/env";
import { sendMail } from "@/shared/lib/mail";
import { logger } from "@/shared/lib/logging/logger";
import { computeBackoffMs, sanitizeProviderError } from "./backoff";

/**
 * Abandoned-cart recovery emails (T-5.1, migration 0037). A scan finds
 * ACTIVE carts whose logged-in owner left items idle past the stage delay
 * and — via the (cart_id, stage) UNIQUE claim — enqueues the next reminder
 * with rendered bodies. The dispatch layer runs the auth-email queue's
 * CAS/lease/backoff machine on the new table. Only logged-in carts can be
 * mailed: guest carts carry no email address, by design and by privacy.
 */

/**
 * Stage delays in hours — conservative defaults, tunable without a schema
 * change through CART_RECOVERY_STAGE_HOURS (comma-separated per stage).
 * Decision register D21: stage 1 = 6 h, stage 2 = 24 h, max stages = 2.
 * Stage N only fires when stage N-1 was actually SENT and this stage is
 * unclaimed. A bouncing mailbox (stage 1 FAILED terminal) never receives a
 * repeat. The scan applies a per-user frequency cap so repeated abandon
 * cycles cannot turn into drip spam.
 */
export const DEFAULT_CART_RECOVERY_STAGE_DELAY_HOURS = [6, 24] as const;
/** Per-user cap: no recovery email to the same user within N days. */
export const CART_RECOVERY_FREQUENCY_CAP_DAYS = 7;

export interface CartRecoveryScanConfig {
  /** Per-stage delays in hours (index 0 = stage 1). List length = max stage. */
  stageDelayHours: number[];
  frequencyCapDays: number;
  /** Maximum candidate rows considered per scan run. */
  batchSize: number;
}

export function defaultCartRecoveryScanConfig(): CartRecoveryScanConfig {
  const envRaw = process.env.CART_RECOVERY_STAGE_HOURS;
  let stageDelayHours = [...DEFAULT_CART_RECOVERY_STAGE_DELAY_HOURS] as number[];
  if (envRaw) {
    const parsed = envRaw
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 8);
    if (parsed.length > 0) stageDelayHours = parsed;
  }
  const capEnv = Number.parseInt(process.env.CART_RECOVERY_FREQUENCY_CAP_DAYS ?? "", 10);
  return {
    stageDelayHours,
    frequencyCapDays:
      Number.isInteger(capEnv) && capEnv > 0
        ? capEnv
        : CART_RECOVERY_FREQUENCY_CAP_DAYS,
    batchSize: Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(process.env.CART_RECOVERY_BATCH_SIZE ?? "50", 10) || 50,
      ),
    ),
  };
}

export interface CartSummaryForRecovery {
  itemCount: number;
  itemNames: string[];
}

/**
 * Renderers for one stage of one abandoned cart. Copy is factual: exactly
 * what was left (up to three item names plus a total), and the cart link
 * built from the canonical deployment origin (decision D1).
 */
export function renderCartRecoveryEmail(
  stage: number,
  totalStages: number,
  summary: CartSummaryForRecovery,
): { subject: string; bodyHtml: string; bodyText: string } {
  const baseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, "");
  const cartUrl = `${baseUrl}/cart`;
  const count = summary.itemCount;
  const preview = summary.itemNames.slice(0, 3).join(", ");
  const hasMore = count > 3;

  const subject =
    stage === 1
      ? "Your VELORA selection is waiting"
      : "Still holding your VELORA selection";

  const intro =
    stage === 1
      ? `You left ${count} item${count === 1 ? "" : "s"} in your cart.`
      : `Your cart still holds ${count} item${count === 1 ? "" : "s"} — final reminder.`;
  const itemsLine = preview
    ? hasMore
      ? `${preview} and ${count - 3} more.`
      : `${preview}.`
    : "";

  const footNote =
    totalStages > 1 && stage < totalStages
      ? "(You may receive at most one further reminder about this cart.)"
      : "(This is the last reminder about this cart.)";

  const bodyText = [
    intro,
    itemsLine,
    "",
    `Continue shopping: ${cartUrl}`,
    "",
    "— VELORA",
    footNote,
  ].join("\n");

  const bodyHtml = `<p>${intro}</p>${itemsLine ? `<p>${itemsLine}</p>` : ""}<p><a href="${cartUrl}">Return to your cart</a></p><p style="color:#666;font-size:12px">— VELORA</p>`;

  return { subject, bodyHtml, bodyText };
}

export interface RecoveryCandidate {
  cartId: string;
  userId: string;
  email: string;
  itemCount: number;
  itemNames: string[];
  /** Cart idle age in SECONDS by the DB server's clock at scan time.\n   * Ages, never absolute timestamps: both sides of every freshness\n   * comparison are DB-computed, so DB-vs-Node clock skew cannot flip a\n   * decision (same discipline as D17 in the test harness). */
  idleSeconds: number;
  /** Snapshot of this cart's existing recovery rows. */
  priorRows: Array<{ stage: number; status: string }>;
  /** Age of the user's newest recovery row (ANY cart), in DB seconds. */
  recoveryAgeSeconds: number | null;
}

/**
 * Candidate carts ordered by oldest inactivity first. Deliberately a simple
 * read (no stage logic in SQL): eligibility rules are resolved in
 * `resolveCandidateStage`, which is pure and unit-testable. Guest carts,
 * empty carts and DISABLED-user carts never enter the result set.
 */
export async function findRecoveryCandidates(
  config: CartRecoveryScanConfig,
): Promise<RecoveryCandidate[]> {
  const rows = (await db.execute(sql`
    SELECT c.id AS "cartId",
           c.user_id AS "userId",
           u.email AS "email",
           GREATEST(
             c.updated_at,
             COALESCE(
               (SELECT MAX(ci.updated_at) FROM "cart_items" ci WHERE ci.cart_id = c.id),
               c.updated_at
             )
           ) AS "lastActivity",
           EXTRACT (EPOCH FROM (now() - GREATEST(
             c.updated_at,
             COALESCE(
               (SELECT MAX(ci.updated_at) FROM "cart_items" ci WHERE ci.cart_id = c.id),
               c.updated_at
             )
           )))::int AS "idleSeconds",
           (SELECT COUNT(*)::int FROM "cart_items" ci WHERE ci.cart_id = c.id) AS "itemCount",
           (
             SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('name', ni.name)), '[]'::json)
             FROM (
               SELECT p.name
               FROM "cart_items" ci2
               INNER JOIN "product_variant" pv ON pv.id = ci2.variant_id
               INNER JOIN "products" p ON p.id = pv.product_id
               WHERE ci2.cart_id = c.id
               ORDER BY ci2.created_at
               LIMIT 3
             ) ni
           ) AS "itemNames",
           (
             SELECT JSON_AGG(JSON_BUILD_OBJECT('stage', r.stage, 'status', r.status))
             FROM "cart_recovery_emails" r
             WHERE r.cart_id = c.id
               AND r.stage > 0
               AND r.stage <= ${config.stageDelayHours.length}
           ) AS "priorRows",
           (
             SELECT EXTRACT (EPOCH FROM (now() - MAX(r2.created_at)))::int
             FROM "cart_recovery_emails" r2
             WHERE r2.user_id = c.user_id
           ) AS "recoveryAgeSeconds"
    FROM "cart" c
    INNER JOIN "user" u ON u.id = c.user_id AND u.status = 'ACTIVE'
    WHERE c.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM "cart_items" ci WHERE ci.cart_id = c.id)
    ORDER BY 4 ASC
    LIMIT ${config.batchSize}
  `)) as Array<{
    cartId: string;
    userId: string;
    email: string;
    idleSeconds: number;
    itemCount: number;
    itemNames: Array<{ name: string }> | null;
    priorRows: Array<{ stage: number; status: string }> | null;
    recoveryAgeSeconds: number | null;
  }>;

  return rows.map((r) => ({
    cartId: r.cartId,
    userId: r.userId,
    email: r.email,
    itemCount: Number(r.itemCount ?? 0),
    itemNames: (r.itemNames ?? []).map((n) => String(n.name)),
    idleSeconds: Number(r.idleSeconds ?? 0),
    priorRows: (r.priorRows ?? []).map((row) => ({
      stage: Number(row.stage),
      status: String(row.status),
    })),
    recoveryAgeSeconds:
      r.recoveryAgeSeconds === null || r.recoveryAgeSeconds === undefined
        ? null
        : Number(r.recoveryAgeSeconds),
  }));
}

/**
 * Pure stage resolver: the stage to enqueue for one candidate, or null.
 *
 * - stage 1..N eligible when the cart's DB-measured idle age exceeds that
 *   stage's delay (delays increase, so the first miss ends the ladder);
 * - stage N > 1 additionally requires stage N-1 to be SENT;
 * - a stage already claimed (any status other than FAILED) is never
 *   re-enqueued for the same cart;
 * - the per-user frequency cap suppresses carts that are NOT already in a
 *   recovery sequence (no prior rows): a cart mid-ladder always resumes its
 *   own stages, a brand-new abandon cycle stays quiet while the cap window
 *   is open (even for a brand-new cart).
 */
export function resolveCandidateStage(
  candidate: Pick<RecoveryCandidate, "idleSeconds" | "priorRows" | "recoveryAgeSeconds">,
  config: CartRecoveryScanConfig,
): number | null {
  if (
    candidate.priorRows.length === 0 &&
    candidate.recoveryAgeSeconds !== null &&
    candidate.recoveryAgeSeconds < config.frequencyCapDays * 86_400
  ) {
    return null; // cap window still open for a NEW abandon cycle
  }

  const claimed = new Map(candidate.priorRows.map((r) => [r.stage, r.status]));
  let eligible: number | null = null;
  for (let stage = 1; stage <= config.stageDelayHours.length; stage += 1) {
    const delayHours = config.stageDelayHours[stage - 1];
    if (delayHours === undefined) {
      break; // indexed under the list length — defensive only
    }
    const delaySeconds = delayHours * 3600;
    if (candidate.idleSeconds < delaySeconds) {
      break; // delays are increasing; nothing later can be due either
    }
    if (stage > 1 && claimed.get(stage - 1) !== "SENT") {
      break; // stage ladder requires the previous stage delivered
    }
    const current = claimed.get(stage);
    if (current && current !== "FAILED") {
      continue; // already claimed (queued/sending/sent)
    }
    if (!current) {
      eligible = stage; // the highest claimable so far
    }
  }
  return eligible;
}

export interface ScanRunResult {
  considered: number;
  enqueued: Array<{ cartId: string; stage: number; id: string | null }>;
  skippedByCap: number;
  skippedByStage: number;
}

/**
 * One scan run: read candidates, enqueue every cart's next stage, kick a
 * fire-and-forget first send. The UNIQUE (cart_id, stage) index makes this
 * idempotent — concurrent or repeated scans cannot double-enqueue.
 */
export async function scanAndEnqueueAbandonedCarts(
  configPartial: Partial<CartRecoveryScanConfig> = {},
): Promise<ScanRunResult> {
  const config = { ...defaultCartRecoveryScanConfig(), ...configPartial };
  const candidates = await findRecoveryCandidates(config);

  const result: ScanRunResult = {
    considered: candidates.length,
    enqueued: [],
    skippedByCap: 0,
    skippedByStage: 0,
  };

  for (const candidate of candidates) {
    const stage = resolveCandidateStage(candidate, config);
    if (stage === null) {
      if (
        candidate.priorRows.length === 0 &&
        candidate.recoveryAgeSeconds !== null &&
        candidate.recoveryAgeSeconds < config.frequencyCapDays * 86_400
      ) {
        result.skippedByCap += 1;
      } else {
        result.skippedByStage += 1;
      }
      continue;
    }

    const rendered = renderCartRecoveryEmail(
      stage,
      config.stageDelayHours.length,
      { itemCount: candidate.itemCount, itemNames: candidate.itemNames },
    );
    const inserted: string | null = await enqueueCartRecoveryEmail({
      cartId: candidate.cartId,
      userId: candidate.userId,
      stage,
      recipientEmail: candidate.email,
      ...rendered,
    });
    if (inserted === null) {
      // Unique-claim lost to a concurrent scan, or FK collapse mid-flight:
      // not an error, another worker owns this stage.
      result.skippedByStage += 1;
      continue;
    }
    result.enqueued.push({ cartId: candidate.cartId, stage, id: inserted });
    // Fire-and-forget first send: enqueue path does NOT bump attempts
    // (identical accounting to the auth-email queue; worker claims do).
    void dispatchCartRecoveryEmail(inserted);
  }

  logger.info("Cart recovery scan completed", {
    module: "notifications",
    action: "scanAbandonedCarts",
    considered: result.considered,
    enqueued: result.enqueued.length,
    skippedByCap: result.skippedByCap,
    skippedByStage: result.skippedByStage,
  });
  return result;
}

export interface CartRecoveryEmailInput {
  cartId: string;
  userId: string;
  stage: number;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/**
 * Insert the queued row. Returns null when the claim could not be made
 * (cart vanished, or the (cart_id, stage) unique was lost to a concurrent
 * scan). Never throws at the caller — a recovery-email hiccup may not break
 * anything else.
 */
export async function enqueueCartRecoveryEmail(
  input: CartRecoveryEmailInput,
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(cartRecoveryEmails)
      .values({
        cartId: input.cartId,
        userId: input.userId,
        stage: input.stage,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
      })
      .returning({ id: cartRecoveryEmails.id });
    return row?.id ?? null;
  } catch (error) {
    logger.error("Cart recovery email enqueue failed", {
      module: "notifications",
      action: "cartRecoveryEnqueueFailed",
      cartId: input.cartId,
      stage: input.stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

/**
 * CAS QUEUED -> SENDING before the SMTP call (identical to
 * `startAuthEmailDispatch`): a worker winning between enqueue and this CAS
 * suppresses our attempt; a crash leaves a lease the worker reaps. The
 * lease is stamped with the CLIENT clock on purpose — the worker's
 * stale-lease cutoff is also client-clock (same convention as the
 * auth-email worker), so both sides of that comparison share one clock.
 */
async function startCartRecoveryDispatch(id: string): Promise<boolean> {
  const rows = await db
    .update(cartRecoveryEmails)
    .set({ status: "SENDING", updatedAt: new Date() })
    .where(and(eq(cartRecoveryEmails.id, id), eq(cartRecoveryEmails.status, "QUEUED")))
    .returning({ id: cartRecoveryEmails.id });
  return rows.length > 0;
}

/**
 * One send attempt for one queued row. SMTP failure schedules a bounded
 * retry; nothing ever throws.
 */
export async function dispatchCartRecoveryEmail(
  id: string,
): Promise<{ sent: boolean; reason?: string }> {
  const leased = await startCartRecoveryDispatch(id);
  if (!leased) return { sent: false, reason: "not-claimed" };

  const [row] = await db
    .select({
      stage: cartRecoveryEmails.stage,
      recipientEmail: cartRecoveryEmails.recipientEmail,
      subject: cartRecoveryEmails.subject,
      bodyHtml: cartRecoveryEmails.bodyHtml,
      bodyText: cartRecoveryEmails.bodyText,
    })
    .from(cartRecoveryEmails)
    .where(eq(cartRecoveryEmails.id, id));

  if (!row) return { sent: false, reason: "row-missing" };

  try {
    const info = await sendMail({
      to: row.recipientEmail,
      subject: row.subject,
      html: row.bodyHtml,
      text: row.bodyText,
    });
    await db
      .update(cartRecoveryEmails)
      .set({
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: (info as { messageId?: string } | undefined)?.messageId ?? null,
        lastError: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(eq(cartRecoveryEmails.id, id));
    return { sent: true };
  } catch (error) {
    const [current] = await db
      .select({ attempts: cartRecoveryEmails.attempts })
      .from(cartRecoveryEmails)
      .where(eq(cartRecoveryEmails.id, id));
    const attempts = (current?.attempts ?? 0) + 1;
    await db
      .update(cartRecoveryEmails)
      .set({
        status: "QUEUED",
        attempts,
        nextRetryAt: new Date(Date.now() + computeBackoffMs(attempts)),
        lastError: sanitizeProviderError(error),
        updatedAt: new Date(),
      })
      .where(eq(cartRecoveryEmails.id, id));
    logger.error("Cart recovery email send failed", {
      module: "notifications",
      action: "cartRecoverySendFailed",
      cartRecoveryEmailId: id,
      stage: row.stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { sent: false, reason: "provider-error" };
  }
}
