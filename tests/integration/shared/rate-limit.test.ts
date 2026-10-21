import { vi } from "vitest";

// rate-limit.ts resolves its database handle through
// @/infrastructure/database, which carries a `server-only` marker that
// vitest cannot import directly — swap it for the test harness client.
vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

import { describe, it, expect, afterAll } from "vitest";
import { like } from "drizzle-orm";

import { testDb } from "../_db";
import { rateLimit } from "@/infrastructure/database/schema/rate-limit";
import { consumeRateLimit } from "@/shared/lib/rate-limit";

const SFX = `rl-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const RULE = { window: 600, max: 3 };

afterAll(async () => {
  // Crash-residue hygiene: these keys are random per run, but never leak.
  await testDb.delete(rateLimit).where(like(rateLimit.key, `${SFX}%`));
});

describe("consumeRateLimit (Better Auth rate_limit table)", () => {
  it("allows up to max attempts in the window, then blocks per actor", { timeout: 20_000 }, async () => {
    for (let i = 0; i < RULE.max; i += 1) {
      expect(await consumeRateLimit(SFX, "actor", RULE)).toBe(true);
    }
    expect(await consumeRateLimit(SFX, "actor", RULE)).toBe(false);
    // A different actor's budget is independent.
    expect(await consumeRateLimit(SFX, "other", RULE)).toBe(true);
  });

  it("opens a fresh window once last_request falls outside it", { timeout: 20_000 }, async () => {
    expect(await consumeRateLimit(SFX, "windowed", RULE)).toBe(true);
    expect(await consumeRateLimit(SFX, "windowed", RULE)).toBe(true);
    expect(await consumeRateLimit(SFX, "windowed", RULE)).toBe(true);
    expect(await consumeRateLimit(SFX, "windowed", RULE)).toBe(false);

    // Backdate past the window: the next attempt resets the counter.
    await testDb
      .update(rateLimit)
      .set({ lastRequest: Date.now() - (RULE.window + 30) * 1000 })
      .where(like(rateLimit.key, `${SFX}:windowed`));

    expect(await consumeRateLimit(SFX, "windowed", RULE)).toBe(true);
    const [row] = await testDb
      .select()
      .from(rateLimit)
      .where(like(rateLimit.key, `${SFX}:windowed`));
    expect(row?.count).toBe(1);
  });

  it("is atomic under a concurrent burst (limit exactly max)", { timeout: 30_000 }, async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeRateLimit(SFX, "burst", RULE)),
    );
    expect(results.filter(Boolean)).toHaveLength(RULE.max);
  });
});
