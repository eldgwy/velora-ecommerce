"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/shared/lib/guards";
import { ensureCustomerProfile } from "@/services/customer.service";
import {
  createAddress as createAddressService,
  deleteAddress as deleteAddressService,
  setDefaultAddress as setDefaultAddressService,
  updateAddress as updateAddressService,
} from "@/services/address.service";
import { addressIdSchema, addressSchema } from "@/shared/types/address";
import type { ActionResult } from "@/shared/types/actions";

// ============================================
// FR-02.02 — Address Book Management
// ============================================

const GENERIC_ERROR =
  "We couldn't save that address. Please try again.";
const NOT_FOUND_ERROR = "That address could not be found.";

/**
 * `Create Address` (SRS FR-02.02).
 *
 * Accepts `country`, `city`, `state`, `postalCode`, `label`,
 * `addressLine1-3`, `isDefault`. Creating with `isDefault = true` runs in an
 * atomic transaction that clears the flag on every sibling address.
 */
export async function createAddress(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Please review the form and retry.",
    };
  }

  const session = await requireSession("/account/profile");

  try {
    const profile = await ensureCustomerProfile(session.user);
    const created = await createAddressService(profile.id, parsed.data);

    revalidatePath("/account/profile");

    return { ok: true, data: { id: created.id } };
  } catch (error) {
    console.error("[address] createAddress failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * `Update Address` (SRS FR-02.02). Ownership is scoped to the session's
 * customer; `isDefault = true` atomically demotes all other addresses.
 */
export async function updateAddress(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const idParsed = addressIdSchema.safeParse(id);
  if (!idParsed.success) return { ok: false, error: NOT_FOUND_ERROR };

  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Please review the form and retry.",
    };
  }

  const session = await requireSession("/account/profile");

  try {
    const profile = await ensureCustomerProfile(session.user);
    const updated = await updateAddressService(profile.id, idParsed.data, parsed.data);

    if (!updated) return { ok: false, error: NOT_FOUND_ERROR };

    revalidatePath("/account/profile");

    return { ok: true };
  } catch (error) {
    console.error("[address] updateAddress failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * `Set Default Address` (SRS FR-02.02) — a single atomic transaction
 * updates all other addresses for the `customerId` to `isDefault = false`.
 */
export async function setDefaultAddress(id: string): Promise<ActionResult> {
  const idParsed = addressIdSchema.safeParse(id);
  if (!idParsed.success) return { ok: false, error: NOT_FOUND_ERROR };

  const session = await requireSession("/account/profile");

  try {
    const profile = await ensureCustomerProfile(session.user);
    const found = await setDefaultAddressService(profile.id, idParsed.data);

    if (!found) return { ok: false, error: NOT_FOUND_ERROR };

    revalidatePath("/account/profile");

    return { ok: true };
  } catch (error) {
    console.error("[address] setDefaultAddress failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * `Delete Address` (SRS FR-02.02). Deletes the record from `addresses`
 * only — historical copies in `order_addresses` are never cascaded.
 */
export async function deleteAddress(id: string): Promise<ActionResult> {
  const idParsed = addressIdSchema.safeParse(id);
  if (!idParsed.success) return { ok: false, error: NOT_FOUND_ERROR };

  const session = await requireSession("/account/profile");

  try {
    const profile = await ensureCustomerProfile(session.user);
    const deleted = await deleteAddressService(profile.id, idParsed.data);

    if (!deleted) return { ok: false, error: NOT_FOUND_ERROR };

    revalidatePath("/account/profile");

    return { ok: true };
  } catch (error) {
    console.error("[address] deleteAddress failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
