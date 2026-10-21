import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { user, userAdminEvents } from "@/infrastructure/database/schema";
import { customerProfiles } from "@/infrastructure/database/schema/customers";
import { escapeILike } from "@/shared/lib/like-patterns";

// ============================================
// Types
// ============================================

export type AdminUserRole = typeof user.role.enumValues[number];
export type AdminUserStatus = typeof user.status.enumValues[number];

export const USER_ADMIN_EVENT_TYPES = ["STATUS_CHANGED", "ROLE_CHANGED"] as const;
export type UserAdminEventType = (typeof USER_ADMIN_EVENT_TYPES)[number];

export interface AdminAccountRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AdminUserRole;
  status: AdminUserStatus;
  createdAt: Date;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AdminUserRole;
  status: AdminUserStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toAccountRow(row: UserRow): AdminAccountRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
  };
}

// ============================================
// Account reads
// ============================================

const toUserRow = (u: typeof user.$inferSelect): UserRow => u as UserRow;

/**
 * Paginated account list for the admin console. Search matches name or
 * email (ILIKE, escaped). Newest first, email as a deterministic tie-break.
 */
export async function listUsersForAdmin(
  opts: { query?: string; status?: AdminUserStatus; role?: AdminUserRole; page?: number; pageSize?: number } = {},
): Promise<{ items: AdminAccountRow[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const conditions = [];
  if (opts.query && opts.query.trim().length > 0) {
    const pattern = `%${escapeILike(opts.query.trim())}%`;
    conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern)));
  }
  if (opts.status) conditions.push(eq(user.status, opts.status));
  if (opts.role) conditions.push(eq(user.role, opts.role));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(user)
    .where(where);
  const total = countRow?.count ?? 0;

  const rows = await db
    .select()
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt), asc(user.email))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map(toUserRow).map(toAccountRow),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getUserForAdmin(
  userId: string,
): Promise<(AdminAccountRow & { profile: typeof customerProfiles.$inferSelect | null }) | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  if (!row) return null;
  const [profile] = await db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId));
  return { ...toAccountRow(toUserRow(row)), profile: profile ?? null };
}

// ============================================
// Account writes (audited)
// ============================================

/**
 * Change an account's status (ACTIVE ↔ NOTACTIVE). Both the account update
 * and the audit event share one transaction: a change is never visible
 * without its trail. Callers must pass an admin id from the verified
 * server session; self-changes are rejected (lockout protection).
 */
export async function setUserStatus(
  userId: string,
  status: AdminUserStatus,
  opts: { actorId: string; actorType?: string; reason?: string; requestId?: string } = { actorId: "unknown" },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (userId === opts.actorId) {
    return { ok: false, error: "You cannot change the status of your own account." };
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: user.status }).from(user).where(eq(user.id, userId));
    if (!current) return { ok: false as const, error: "That account could not be found." };
    if (current.status === status) {
      return { ok: true as const };
    }

    await tx.update(user).set({ status }).where(eq(user.id, userId));
    await tx.insert(userAdminEvents).values({
      userId,
      eventType: "STATUS_CHANGED",
      previousValue: current.status,
      newValue: status,
      actorType: opts.actorType ?? "admin",
      actorId: opts.actorId,
      reason: opts.reason,
    });

    return { ok: true as const };
  });
}

/**
 * Change an account's role (ADMIN | STAFF | CUSTOMER), audited like status.
 * Self-role-change is rejected server-side to prevent accidental privilege
 * games from inside the console.
 */
export async function setUserRole(
  userId: string,
  role: AdminUserRole,
  opts: { actorId: string; actorType?: string; reason?: string; requestId?: string } = { actorId: "unknown" },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (userId === opts.actorId) {
    return { ok: false, error: "You cannot change the role of your own account." };
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select({ role: user.role }).from(user).where(eq(user.id, userId));
    if (!current) return { ok: false as const, error: "That account could not be found." };
    if (current.role === role) {
      return { ok: true as const };
    }

    await tx.update(user).set({ role }).where(eq(user.id, userId));
    await tx.insert(userAdminEvents).values({
      userId,
      eventType: "ROLE_CHANGED",
      previousValue: current.role,
      newValue: role,
      actorType: opts.actorType ?? "admin",
      actorId: opts.actorId,
      reason: opts.reason,
    });

    return { ok: true as const };
  });
}

// ============================================
// Audit trail reads
// ============================================

export async function listUserAdminEvents(
  userId: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    eventType: string;
    previousValue: string | null;
    newValue: string;
    actorId: string;
    reason: string | null;
    createdAt: Date;
  }>
> {
  const rows = await db
    .select({
      id: userAdminEvents.id,
      eventType: userAdminEvents.eventType,
      previousValue: userAdminEvents.previousValue,
      newValue: userAdminEvents.newValue,
      actorId: userAdminEvents.actorId,
      reason: userAdminEvents.reason,
      createdAt: userAdminEvents.createdAt,
    })
    .from(userAdminEvents)
    .where(eq(userAdminEvents.userId, userId))
    .orderBy(desc(userAdminEvents.createdAt))
    .limit(limit);
  return rows;
}
