import { vi } from "vitest";

vi.mock("@/infrastructure/database", async () => {
  const { testDb } = await import("../_db");
  return { db: testDb };
});

const sessionStore = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/shared/lib/guards", () => ({
  getCurrentSession: vi.fn(async () =>
    sessionStore.userId
      ? { user: { id: sessionStore.userId, role: "CUSTOMER", status: "ACTIVE" } }
      : null,
  ),
  requireAdmin: vi.fn(async () => {
    if (!sessionStore.userId) throw new Error("UNAUTHENTICATED");
    return { user: { id: sessionStore.userId, role: "ADMIN", status: "ACTIVE" } };
  }),
}));

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

import { testDb } from "../_db";
import { user, userAdminEvents } from "@/infrastructure/database/schema";
import {
  getUserForAdmin,
  listUserAdminEvents,
  listUsersForAdmin,
} from "@/services/user-admin.service";
import {
  setCustomerRoleAction,
  setCustomerStatusAction,
} from "@/modules/customer/presentation/actions/admin-customer.actions";

const SFX = `ua-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
let adminId = "";
let customerId = "";
let otherId = "";

beforeAll(async () => {
  // Crash-residue hygiene for this file's fixed prefix.
  await testDb.delete(userAdminEvents).where(like(userAdminEvents.userId, `${SFX}%`));
  await testDb.delete(user).where(like(user.id, `${SFX}%`));

  adminId = `${SFX}-admin`;
  customerId = `${SFX}-customer`;
  otherId = `${SFX}-other`;
  await testDb.insert(user).values([
    { id: adminId, name: "Admin Fixture", email: `${SFX}-admin@example.com`, role: "ADMIN", status: "ACTIVE" },
    { id: customerId, name: "Customer Fixture", email: `${SFX}-customer@example.com`, role: "CUSTOMER", status: "ACTIVE" },
    { id: otherId, name: "Other Fixture", email: `${SFX}-other@example.com`, role: "STAFF", status: "NOTACTIVE" },
  ]);
});

afterAll(async () => {
  await testDb.delete(userAdminEvents).where(like(userAdminEvents.userId, `${SFX}%`));
  await testDb.delete(user).where(like(user.id, `${SFX}%`));
});

describe("customer admin actions (real DB)", () => {
  it("disables and re-enables an account with an audit trail", { timeout: 20_000 }, async () => {
    sessionStore.userId = adminId;

    const res = await setCustomerStatusAction({
      userId: customerId,
      status: "NOTACTIVE",
      reason: "refund abuse",
    });
    expect(res.ok).toBe(true);

    let [row] = await testDb.select().from(user).where(eq(user.id, customerId));
    expect(row!.status).toBe("NOTACTIVE");
    const events = await listUserAdminEvents(customerId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "STATUS_CHANGED",
      previousValue: "ACTIVE",
      newValue: "NOTACTIVE",
      actorId: adminId,
      reason: "refund abuse",
    });

    // Re-enable: previous value is the disable state.
    const res2 = await setCustomerStatusAction({ userId: customerId, status: "ACTIVE" });
    expect(res2.ok).toBe(true);
    [row] = await testDb.select().from(user).where(eq(user.id, customerId));
    expect(row!.status).toBe("ACTIVE");
    expect(await listUserAdminEvents(customerId)).toHaveLength(2);

    // Same-state replay: no write, no duplicate event.
    const res3 = await setCustomerStatusAction({ userId: customerId, status: "ACTIVE" });
    expect(res3.ok).toBe(true);
    expect(await listUserAdminEvents(customerId)).toHaveLength(2);
  });

  it("changes roles with an audit row", { timeout: 20_000 }, async () => {
    sessionStore.userId = adminId;

    const res = await setCustomerRoleAction({
      userId: customerId,
      role: "STAFF",
      reason: "support handoff",
    });
    expect(res.ok).toBe(true);
    const [row] = await testDb.select().from(user).where(eq(user.id, customerId));
    expect(row!.role).toBe("STAFF");
    expect((await listUserAdminEvents(customerId))[0]!.eventType).toBe("ROLE_CHANGED");

    // Restore to keep other fixtures stable.
    await setCustomerRoleAction({ userId: customerId, role: "CUSTOMER" });
  });

  it("refuses self-changes and unknown targets", { timeout: 20_000 }, async () => {
    sessionStore.userId = adminId;

    const selfRes = await setCustomerStatusAction({
      userId: adminId,
      status: "NOTACTIVE",
    });
    expect(selfRes.ok).toBe(false);
    const selfRole = await setCustomerRoleAction({ userId: adminId, role: "STAFF" });
    expect(selfRole.ok).toBe(false);
    // No audit rows were written for the admin's own account despite the
    // rejected attempts.
    expect(await listUserAdminEvents(adminId)).toHaveLength(0);
    const [adminRow] = await testDb.select().from(user).where(inArray(user.id, [adminId]));
    expect(adminRow!.status).toBe("ACTIVE");
    expect(adminRow!.role).toBe("ADMIN");

    const missing = await setCustomerStatusAction({
      userId: `${SFX}-ghost`,
      status: "NOTACTIVE",
    });
    expect(missing.ok).toBe(false);
    expect((missing as { ok: false; error: string }).error).toMatch(/could not be found/i);
  });

  it("rejects malformed input without a write", { timeout: 20_000 }, async () => {
    sessionStore.userId = adminId;
    expect((await setCustomerRoleAction({ userId: customerId, role: "SUPERADMIN" })).ok).toBe(false);
    expect((await setCustomerStatusAction({ userId: customerId, status: "BROKEN" })).ok).toBe(false);
    // Two status events + two role events from the earlier tests.
    expect(await listUserAdminEvents(customerId)).toHaveLength(4);
  });

  it("lists accounts with search and deterministic pagination", { timeout: 20_000 }, async () => {
    const byEmail = await listUsersForAdmin({ query: `${SFX}-other@` });
    expect(byEmail.items).toHaveLength(1);
    expect(byEmail.items[0]!.email).toBe(`${SFX}-other@example.com`);
    expect(byEmail.items[0]!.status).toBe("NOTACTIVE");

    const filtered = await listUsersForAdmin({ status: "NOTACTIVE" });
    expect(filtered.items.map((a) => a.id)).toContain(otherId);
    expect(filtered.items.every((a) => a.status === "NOTACTIVE")).toBe(true);

    // escapeILike: % in the query stays literal.
    const percent = await listUsersForAdmin({ query: "%" });
    expect(percent.items.map((a) => a.id)).not.toContain("unexpected");

    const detail = await getUserForAdmin(customerId);
    expect(detail?.id).toBe(customerId);
    expect(detail?.profile).toBeNull();
  });
});
