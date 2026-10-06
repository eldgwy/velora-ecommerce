import { eq } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { customerProfiles } from "@/infrastructure/database/schema";

// ============================================
// Types
// ============================================

export type CustomerProfileRow = typeof customerProfiles.$inferSelect;

/** Only the mutable fields from SRS FR-02.01 may reach `updateCustomerProfile`. */
export interface ProfilePatch {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  phone?: string | null;
  birthday?: Date | null;
  preferredLanguage?: "en" | "ar";
}

// ============================================
// Reads
// ============================================

/**
 * Fetch the profile bound to `userId`. Every read is keyed by the
 * authenticated user id — FR-02.01 treats `userId` as immutable.
 */
export async function getCustomerProfile(
  userId: string,
): Promise<CustomerProfileRow | undefined> {
  return db.query.customerProfiles.findFirst({
    where: eq(customerProfiles.userId, userId),
  });
}

// ============================================
// Profile lifecycle
// ============================================

/**
 * Return the customer profile for `user`, creating it on first access.
 *
 * SRS FR-01.01 expects a `customer_profile` row at registration, but sign-up
 * is owned by better-auth and neither a hook nor a trigger backfills accounts
 * (existing or future). The lazy insert here covers both: it is race-safe via
 * the unique `customer_profile_user_id_unique` index
 * (`onConflictDoNothing`), and splits the better-auth display name into
 * `firstName` / `lastName` because both columns are `NOT NULL`.
 */
export async function ensureCustomerProfile(user: {
  id: string;
  name: string;
}): Promise<CustomerProfileRow> {
  const existing = await getCustomerProfile(user.id);
  if (existing) return existing;

  const parts = user.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Customer";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;

  const [created] = await db
    .insert(customerProfiles)
    .values({ userId: user.id, firstName, lastName })
    .onConflictDoNothing({ target: customerProfiles.userId })
    .returning();

  if (created) return created;

  // Another request won the insert race — re-read the winner's row.
  const raced = await getCustomerProfile(user.id);
  if (!raced) throw new Error("Could not initialise the customer profile.");

  return raced;
}

// ============================================
// Update (FR-02.01)
// ============================================

/**
 * Persist the mutable profile fields for `userId` (SRS FR-02.01).
 *
 * Processing logic:
 *  - The `WHERE` clause is derived from `userId`, which the caller got from
 *    the authenticated session — `id` / `userId` can never be written.
 *  - Only the whitelisted mutable columns are accepted (`ProfilePatch`).
 *  - `birthday` is stored as UTC-midnight of the chosen calendar day so the
 *    date survives the `timestamp` (no timezone) round-trip unchanged.
 */
export async function updateCustomerProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<CustomerProfileRow> {
  const profile = await getCustomerProfile(userId);
  if (!profile) throw new Error("Customer profile not found.");

  const values: { updatedAt: Date } & ProfilePatch = {
    updatedAt: new Date(),
  };

  if (patch.firstName !== undefined) values.firstName = patch.firstName;
  if (patch.middleName !== undefined) values.middleName = patch.middleName;
  if (patch.lastName !== undefined) values.lastName = patch.lastName;
  if (patch.phone !== undefined) values.phone = patch.phone;
  if (patch.birthday !== undefined) values.birthday = patch.birthday;
  if (patch.preferredLanguage !== undefined) {
    values.preferredLanguage = patch.preferredLanguage;
  }

  const [updated] = await db
    .update(customerProfiles)
    .set(values)
    .where(eq(customerProfiles.id, profile.id))
    .returning();

  if (!updated) throw new Error("Customer profile update failed.");

  return updated;
}
