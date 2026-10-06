"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/shared/lib/guards";
import {
  ensureCustomerProfile,
  updateCustomerProfile,
  type ProfilePatch,
} from "@/services/customer.service";
import { profileUpdateSchema } from "@/shared/types/profile";
import type { ActionResult } from "@/shared/types/actions";

// ============================================
// FR-02.01 — Customer Profile Inspection & Update
// ============================================

/**
 * Persist the mutable profile fields (SRS FR-02.01).
 *
 * Processing logic: validate with Zod → enforce `userId` matches the
 * authenticated session (`requireSession`) → update only the whitelisted
 * mutable columns. `id` / `userId` are immutable and never accepted.
 */
export async function updateProfile(input: unknown): Promise<ActionResult> {
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Please review the form and retry.",
    };
  }

  // Outside try/catch so the login redirect always propagates.
  const session = await requireSession("/account/profile");

  try {
    await ensureCustomerProfile(session.user);

    const data = parsed.data;
    const patch: ProfilePatch = {};

    if (data.firstName !== undefined) patch.firstName = data.firstName;
    if (data.middleName !== undefined) {
      patch.middleName = data.middleName === "" ? null : data.middleName;
    }
    if (data.lastName !== undefined) patch.lastName = data.lastName;
    if (data.phone !== undefined) {
      patch.phone = data.phone === "" ? null : data.phone;
    }
    if (data.birthday !== undefined) {
      // Store the chosen calendar day as UTC midnight (see customer.service).
      patch.birthday =
        data.birthday === "" ? null : new Date(`${data.birthday}T00:00:00.000Z`);
    }
    if (data.preferredLanguage !== undefined) {
      patch.preferredLanguage = data.preferredLanguage;
    }

    await updateCustomerProfile(session.user.id, patch);

    revalidatePath("/account/profile");
    revalidatePath("/account/settings");

    return { ok: true };
  } catch (error) {
    console.error("[profile] updateProfile failed:", error);
    return {
      ok: false,
      error: "We couldn't save your profile changes. Please try again.",
    };
  }
}
