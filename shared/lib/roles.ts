// ============================================
// Canonical role & status types
// ============================================
//
// Single source of truth for RBAC (FR-01.06), mirroring the Postgres enums
// in `db/schema/enums.ts` (`user_role`, `user_status`). Import this — not
// the drizzle schema — from auth-adjacent code so server auth, guards and
// the proxy all agree on the same literals.

export const USER_ROLES = ["CUSTOMER", "STAFF", "ADMIN"] as const;

/** Roles every account carries; defaults to `CUSTOMER`. */
export type UserRole = (typeof USER_ROLES)[number];

/** Roles permitted to reach `/admin/*` (SRS FR-01.06). */
export const ADMIN_ROLES: readonly UserRole[] = ["ADMIN", "STAFF"];

export const USER_STATUSES = ["ACTIVE", "NOTACTIVE"] as const;

/** Accounts with any other status must be treated as signed out. */
export type UserStatus = (typeof USER_STATUSES)[number];
