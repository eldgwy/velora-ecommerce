import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { testDb } from "../_db";
import { banners } from "@/infrastructure/database/schema/marketing";
import { GET } from "@/app/api/banners/route";

const SFX = `rt-${Date.now()}`;
const IMG = "https://example.com/route.jpg";

beforeEach(async () => {
  const rows = await testDb.select({ id: banners.id }).from(banners);
  for (const r of rows) {
    await testDb.delete(banners).where(eq(banners.id, r.id));
  }
});

describe("GET /api/banners", () => {
  it("returns eligible banners newest-window-first by sortOrder", async () => {
    const now = Date.now();
    await testDb.insert(banners).values([
      {
        title: `Route B ${SFX}`,
        image: IMG,
        status: "ACTIVE",
        sortOrder: 2,
        startsAt: new Date(now - 3600_000),
        endsAt: new Date(now + 3600_000),
      },
      {
        title: `Route A ${SFX}`,
        image: IMG,
        mobileImage: `${IMG}?mobile=1`,
        status: "ACTIVE",
        sortOrder: 1,
        startsAt: new Date(now - 3600_000),
        endsAt: new Date(now + 3600_000),
      },
      {
        title: `Route Draft ${SFX}`,
        image: IMG,
        status: "DRAFT",
        sortOrder: 0,
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ title: string; mobileImage: string | null; sortOrder: number | null }>;
    };
    expect(body.items.map((i) => i.title)).toEqual([`Route A ${SFX}`, `Route B ${SFX}`]);
    expect(body.items[0]!.mobileImage).toBe(`${IMG}?mobile=1`);
  });

  it("returns an empty list when nothing is eligible", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
