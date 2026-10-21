import { sql } from "drizzle-orm";

import { env } from "@/config/env";
import { db } from "@/infrastructure/database";

/**
 * Operational health probe (T-2.7 / GP-18, GP-37): a public, unauthenticated
 * liveness surface for load balancers and uptime monitors. Deliberately
 * minimal:
 * - `database` — round-trip `SELECT 1` against the live pool.
 * - `env` — PRESENCE only for operationally meaningful optional keys
 *   (never values, never required-secret presence). Strict requirements are
 *   enforced fail-closed at process start by config/env, so anything serving
 *   this response already parsed successfully.
 *
 * Not cached: force-dynamic so monitor probes never read stale state, and
 * so a failed DB never looks healthy for the lifetime of a cached response.
 *
 * Vercel Cron sends no Authorization header to GET probes; for anything more
 * revealing than this response an internal job endpoint + CRON_SECRET must
 * be used instead.
 */

const OPTIONAL_ENV_KEYS = [
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GUEST_CART_SECRET",
  "LOW_STOCK_ALERT_RECIPIENTS",
] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const payload: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };

  const database: { status: "up" | "down"; latencyMs?: number } = {
    status: "up",
  };
  const startedAt = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    database.latencyMs = Date.now() - startedAt;
  } catch {
    database.status = "down";
  }

  payload.checks = {
    database,
    env: Object.fromEntries(
      OPTIONAL_ENV_KEYS.map((key) => [key, Boolean(env[key])]),
    ),
  };

  if (database.status === "down") {
    payload.status = "unhealthy";
    return Response.json(payload, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return Response.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
