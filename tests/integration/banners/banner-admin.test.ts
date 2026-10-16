import { vi } from "vitest";

const updateTagSpy = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: updateTagSpy,
  revalidatePath: vi.fn(),
}));

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import { testDb } from "../_db";
import { banners } from "@/infrastructure/database/schema/marketing";
import {
  createBanner,
  deleteBanner,
  reorderBanners,
  transitionBannerStatus,
  updateBanner,
} from "@/modules/banners/application/commands/banners";
import {
  getEligibleBanners,
  listBanners,
} from "@/modules/banners/application/queries/banners";
import { syncBannerStatuses } from "@/modules/jobs/sync-banner-statuses";
import {
  BannerNotFoundError,
  BannerValidationError,
} from "@/modules/banners/domain/banner-errors";

const SFX = `hb-${Date.now()}`;
const createdIds: string[] = [];

async function track(id: string): Promise<string> {
  createdIds.push(id);
  return id;
}

afterAll(async () => {
  const rows = await testDb.select({ id: banners.id }).from(banners);
  for (const r of rows) {
    await testDb.delete(banners).where(eq(banners.id, r.id));
  }
});

beforeEach(async () => {
  const rows = await testDb.select({ id: banners.id }).from(banners);
  for (const r of rows) {
    await testDb.delete(banners).where(eq(banners.id, r.id));
  }
  createdIds.length = 0;
  updateTagSpy.mockClear();
});

const IMG = "https://example.com/hero.jpg";

describe("banner lifecycle", () => {
  it("creates drafts and publishes explicitly", async () => {
    const { id } = await createBanner({ title: `Sale ${SFX}`, image: IMG });
    await track(id);
    const [row] = await testDb.select().from(banners).where(eq(banners.id, id));
    expect(row!.status).toBe("DRAFT");

    await transitionBannerStatus(id, "ACTIVE", "admin-1");
    const [pub] = await testDb.select().from(banners).where(eq(banners.id, id));
    expect(pub!.status).toBe("ACTIVE");
    expect(updateTagSpy).toHaveBeenCalled();
  });

  it("validates fields and rejects illegal transitions", async () => {
    await expect(createBanner({ title: "", image: IMG })).rejects.toBeInstanceOf(
      BannerValidationError,
    );
    await expect(createBanner({ title: "X", image: "" })).rejects.toBeInstanceOf(
      BannerValidationError,
    );
    await expect(
      createBanner({
        title: "X",
        image: IMG,
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(BannerValidationError);
    await expect(
      createBanner({ title: "X", image: IMG, link: "javascript:alert(1)" }),
    ).rejects.toBeInstanceOf(BannerValidationError);

    const { id } = await createBanner({ title: `Guard ${SFX}`, image: IMG });
    await track(id);
    await expect(transitionBannerStatus(id, "EXPIRED", "a")).rejects.toBeInstanceOf(
      BannerValidationError,
    );
    await expect(
      transitionBannerStatus("00000000-0000-0000-0000-000000000000", "ACTIVE", "a"),
    ).rejects.toBeInstanceOf(BannerNotFoundError);
  });

  it("updates content without implicit publication and deletes cleanly", async () => {
    const { id } = await createBanner({
      title: `Edit ${SFX}`,
      image: IMG,
      status: "SCHEDULED",
      startsAt: new Date(Date.now() + 3600_000),
    });
    await track(id);
    await updateBanner({ id, title: `Edited ${SFX}`, image: IMG, status: "SCHEDULED" });
    const [row] = await testDb.select().from(banners).where(eq(banners.id, id));
    expect(row!.title).toBe(`Edited ${SFX}`);
    expect(row!.status).toBe("SCHEDULED");

    await deleteBanner(id);
    createdIds.splice(createdIds.indexOf(id), 1);
    const remaining = await getEligibleBanners(new Date());
    expect(remaining.map((i) => i.id)).not.toContain(id);
  });
});

describe("public eligibility", () => {
  async function eligibleFixture(tag: string, over: Record<string, unknown> = {}) {
    const [row] = await testDb
      .insert(banners)
      .values({
        title: `HB ${tag} ${SFX}`,
        image: IMG,
        status: "ACTIVE",
        sortOrder: 0,
        ...over,
      })
      .returning();
    await track(row.id);
    return row.id;
  }

  it("includes ACTIVE in-window banners ordered deterministically", async () => {
    const now = Date.now();
    const b = await eligibleFixture("open", {
      startsAt: new Date(now - 3600_000),
      endsAt: new Date(now + 3600_000),
      sortOrder: 2,
    });
    const a = await eligibleFixture("open2", {
      startsAt: new Date(now - 3600_000),
      endsAt: new Date(now + 3600_000),
      sortOrder: 1,
    });
    const c = await eligibleFixture("open3", { sortOrder: null });
    const items = await getEligibleBanners(new Date(now));
    const ids = items.map((i) => i.id);
    expect(ids).toEqual([a, b, c]);
    expect(items[0]).toMatchObject({ title: `HB open2 ${SFX}`, image: IMG });
  });

  it("enforces inclusive boundaries and excludes everything else", async () => {
    const now = Date.now();
    const atStart = await eligibleFixture("atstart", {
      startsAt: new Date(now),
      endsAt: new Date(now + 3600_000),
    });
    const atEnd = await eligibleFixture("atend", {
      startsAt: new Date(now - 3600_000),
      endsAt: new Date(now),
    });
    const future = await eligibleFixture("future", {
      startsAt: new Date(now + 1000),
      endsAt: new Date(now + 3600_000),
    });
    const past = await eligibleFixture("past", {
      startsAt: new Date(now - 3600_000),
      endsAt: new Date(now - 1000),
    });
    const [draft] = await testDb
      .insert(banners)
      .values({ title: `HB draft ${SFX}`, image: IMG, status: "DRAFT" })
      .returning();
    await track(draft.id);

    const items = await getEligibleBanners(new Date(now));
    const ids = items.map((i) => i.id);
    expect(ids).toContain(atStart);
    expect(ids).toContain(atEnd);
    expect(ids).not.toContain(future);
    expect(ids).not.toContain(past);
    expect(ids).not.toContain(draft.id);
  });
});

describe("ordering", () => {
  it("persists explicit order densely and rejects partial sets", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { id } = await createBanner({ title: `Order ${i} ${SFX}`, image: IMG });
      await track(id);
      ids.push(id);
    }
    const reversed = [...ids].reverse();
    await reorderBanners(reversed);
    const listed = await listBanners({ pageSize: 50 });
    const listedIds = listed.items.filter((i) => ids.includes(i.id)).map((i) => i.id);
    expect(listedIds).toEqual(reversed);

    await expect(reorderBanners([ids[0]!])).rejects.toBeInstanceOf(BannerValidationError);
    await expect(
      reorderBanners([...ids, "00000000-0000-0000-0000-000000000000"]),
    ).rejects.toBeInstanceOf(BannerValidationError);
    await expect(reorderBanners([ids[0]!, ids[0]!, ids[1]!])).rejects.toBeInstanceOf(
      BannerValidationError,
    );
  });
});

describe("status synchronization job", () => {
  it("opens scheduled windows and closes ended ones, never touching drafts", async () => {
    const now = Date.now();
    const [opening] = await testDb
      .insert(banners)
      .values({
        title: `Sync open ${SFX}`,
        image: IMG,
        status: "SCHEDULED",
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 3600_000),
      })
      .returning();
    const [closing] = await testDb
      .insert(banners)
      .values({
        title: `Sync close ${SFX}`,
        image: IMG,
        status: "ACTIVE",
        startsAt: new Date(now - 3600_000),
        endsAt: new Date(now - 60_000),
      })
      .returning();
    const [draft] = await testDb
      .insert(banners)
      .values({
        title: `Sync draft ${SFX}`,
        image: IMG,
        status: "DRAFT",
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 3600_000),
      })
      .returning();
    const [expired] = await testDb
      .insert(banners)
      .values({
        title: `Sync expired ${SFX}`,
        image: IMG,
        status: "EXPIRED",
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 3600_000),
      })
      .returning();
    for (const r of [opening, closing, draft, expired]) await track(r.id);

    const summary = await syncBannerStatuses(new Date(now));
    expect(summary.transitioned).toBe(2);

    const statusOf = async (id: string) =>
      (await testDb.select().from(banners).where(eq(banners.id, id)))[0]!.status;
    expect(await statusOf(opening.id)).toBe("ACTIVE");
    expect(await statusOf(closing.id)).toBe("EXPIRED");
    expect(await statusOf(draft.id)).toBe("DRAFT");
    expect(await statusOf(expired.id)).toBe("EXPIRED");
  });

  it("requires the cron bearer on the internal route", async () => {
    const { GET } = await import("@/app/api/internal/jobs/sync-banners/route");
    const denied = await GET(new Request("http://localhost/api/internal/jobs/sync-banners"));
    expect(denied.status).toBe(401);
  });
});
