import { and, desc, eq, ne } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { addresses } from "@/infrastructure/database/schema";
import type { AddressFormValues } from "@/shared/types/address";

// ============================================
// Types
// ============================================

export type AddressRow = typeof addresses.$inferSelect;

/** The transaction client handed to `db.transaction` callbacks. */
type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ============================================
// Reads
// ============================================

/**
 * List a customer's saved addresses, default first, newest second —
 * the order the address book renders in.
 */
export async function listAddresses(
  customerId: string,
): Promise<AddressRow[]> {
  return db.query.addresses.findMany({
    where: eq(addresses.customerId, customerId),
    orderBy: [desc(addresses.isDefault), desc(addresses.createdAt)],
  });
}

// ============================================
// Internal helpers (always run inside the caller's transaction)
// ============================================

/**
 * Clear `isDefault` on every default address owned by `customerId`.
 *
 * `exceptId` is the address that must KEEP its default flag (the one being
 * promoted). When `null`, ALL of the customer's defaults are cleared — used by
 * `createAddress`, which has no row id yet and must clear siblings before it
 * inserts the new default, so a partial unique index on
 * `(customer_id) WHERE is_default = true` never sees two defaults at once.
 */
async function clearOtherDefaults(
  tx: TxClient,
  customerId: string,
  exceptId: string | null,
): Promise<void> {
  const whereCondition = exceptId
    ? and(
        eq(addresses.customerId, customerId),
        eq(addresses.isDefault, true),
        ne(addresses.id, exceptId),
      )
    : and(
        eq(addresses.customerId, customerId),
        eq(addresses.isDefault, true),
      );

  await tx
    .update(addresses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(whereCondition);
}

/** Normalise the optional address lines: `""`/`undefined` store as `NULL`. */
function buildValues(data: AddressFormValues) {
  return {
    country: data.country,
    city: data.city,
    state: data.state,
    postalCode: data.postalCode,
    label: data.label,
    addressLine1: data.addressLine1 || null,
    addressLine2: data.addressLine2 || null,
    addressLine3: data.addressLine3 || null,
    isDefault: data.isDefault,
  };
}

// ============================================
// Mutations (SRS FR-02.02)
// ============================================

/**
 * `Create Address` — inserts the row and, when `isDefault` is true, clears
 * every other default in the same atomic transaction.
 *
 * The clear runs BEFORE the insert. That ordering is required for the partial
 * unique index on `(customer_id) WHERE is_default = true`: inserting a new
 * default while another already exists would otherwise violate the index
 * mid-transaction. Clear-then-insert keeps the index satisfied at every
 * statement boundary.
 */
export async function createAddress(
  customerId: string,
  data: AddressFormValues,
): Promise<AddressRow> {
  return db.transaction(async (tx) => {
    if (data.isDefault) {
      await clearOtherDefaults(tx, customerId, null);
    }

    const [created] = await tx
      .insert(addresses)
      .values({ ...buildValues(data), customerId })
      .returning();

    if (!created) throw new Error("Address insert failed.");

    return created;
  });
}

/**
 * `Update Address` — ownership is enforced by scoping every statement to the
 * caller's `customerId`. Setting `isDefault = true` atomically demotes all
 * sibling addresses (FR-02.02). Returns `null` when the address does not
 * belong to this customer (or no longer exists).
 */
export async function updateAddress(
  customerId: string,
  addressId: string,
  data: AddressFormValues,
): Promise<AddressRow | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(
        and(eq(addresses.id, addressId), eq(addresses.customerId, customerId)),
      )
      .limit(1);

    if (!existing) return null;

    if (data.isDefault) {
      await clearOtherDefaults(tx, customerId, addressId);
    }

    const [updated] = await tx
      .update(addresses)
      .set({ ...buildValues(data), updatedAt: new Date() })
      .where(
        and(eq(addresses.id, addressId), eq(addresses.customerId, customerId)),
      )
      .returning();

    return updated ?? null;
  });
}

/**
 * `Set Default Address` — one transaction flips the target on and every
 * sibling off, guaranteeing exactly one default per customer (FR-02.02).
 * Returns `false` when the address is not owned by this customer.
 */
export async function setDefaultAddress(
  customerId: string,
  addressId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(
        and(eq(addresses.id, addressId), eq(addresses.customerId, customerId)),
      )
      .limit(1);

    if (!existing) return false;

    await clearOtherDefaults(tx, customerId, addressId);

    await tx
      .update(addresses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(eq(addresses.id, addressId), eq(addresses.customerId, customerId)),
      );

    return true;
  });
}

/**
 * `Delete Address` — removes the record from `addresses` only.
 *
 * Historical order addresses live in `order_addresses` as denormalized
 * snapshots (no foreign key to `addresses`), so this delete deliberately
 * does NOT cascade to them — past orders keep their original shipping and
 * billing details (SRS FR-02.02). Returns `false` when the address is not
 * owned by this customer.
 */
export async function deleteAddress(
  customerId: string,
  addressId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(addresses)
    .where(
      and(eq(addresses.id, addressId), eq(addresses.customerId, customerId)),
    )
    .returning({ id: addresses.id });

  return deleted.length > 0;
}
