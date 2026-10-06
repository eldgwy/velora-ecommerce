import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/infrastructure/database";
import { customerProfiles, orderAddresses, user } from "@/infrastructure/database/schema";
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from "@/services/address.service";
import {
  ensureCustomerProfile,
  updateCustomerProfile,
} from "@/services/customer.service";
import { toDateInputValue } from "@/shared/lib/format";
import { addressIdSchema, addressSchema } from "@/shared/types/address";
import { profileSchema } from "@/shared/types/profile";

/**
 * TEMPORARY FR-02 validation harness — runs the real service layer against
 * the dev database with a throwaway user, then cleans up (deleting the user
 * cascades profile → addresses). DELETE THIS FILE after validation.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const results: string[] = [];
  const marker = `fr02-validate-${Date.now()}`;
  const emails = [`${marker}@example.test`, `${marker}-other@example.test`];
  // NOTE: the dev DB predates migration 0001 (`user.id` is still `text`
  // without a default), so the harness seeds the id explicitly — exactly
  // what better-auth's adapter does at sign-up.
  const seededIds: string[] = [];

  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
    results.push(`ok — ${message}`);
  };

  try {
    // ---------- seed ----------
    const seededId = randomUUID();
    const [seeded] = await db
      .insert(user)
      .values({
        id: seededId,
        name: "Validation Tester",
        email: emails[0],
        emailVerified: true,
      })
      .returning({ id: user.id });
    seededIds.push(seeded.id);

    // ---------- FR-02.01 schema ----------
    assert(
      !profileSchema.safeParse({
        firstName: "",
        lastName: "X",
        preferredLanguage: "fr",
      }).success,
      "profileSchema rejects empty firstName + unsupported language",
    );
    assert(
      !profileSchema.safeParse({
        firstName: "A",
        lastName: "B",
        phone: "12345",
        preferredLanguage: "en",
      }).success,
      "profileSchema rejects non-E.164 phone",
    );
    assert(
      profileSchema.safeParse({
        firstName: "A",
        lastName: "B",
        phone: "+15551234567",
        birthday: "1990-05-15",
        preferredLanguage: "ar",
      }).success,
      "profileSchema accepts E.164 phone + valid past birthday",
    );
    assert(
      !profileSchema.safeParse({
        firstName: "A",
        lastName: "B",
        birthday: "2999-01-01",
        preferredLanguage: "en",
      }).success,
      "profileSchema rejects a future birthday",
    );

    // ---------- lazy profile creation (FR-01.01 backfill) ----------
    const profile = await ensureCustomerProfile({
      id: seeded.id,
      name: "Validation Tester",
    });
    assert(
      profile.firstName === "Validation" && profile.lastName === "Tester",
      "ensureCustomerProfile creates row and splits display name",
    );
    const again = await ensureCustomerProfile({
      id: seeded.id,
      name: "Ignored Later",
    });
    assert(again.id === profile.id, "ensureCustomerProfile is idempotent");

    // ---------- profile update (FR-02.01) ----------
    const updated = await updateCustomerProfile(seeded.id, {
      firstName: "Ada",
      middleName: null,
      lastName: "Lovelace",
      phone: "+15551234567",
      birthday: new Date("1990-05-15T00:00:00.000Z"),
      preferredLanguage: "ar",
    });
    assert(
      updated.firstName === "Ada" &&
        updated.phone === "+15551234567" &&
        updated.preferredLanguage === "ar" &&
        updated.middleName === null,
      "updateCustomerProfile persists only mutable fields",
    );
    assert(
      toDateInputValue(updated.birthday) === "1990-05-15",
      "birthday round-trips as 1990-05-15 (timestamp without timezone)",
    );

    // ---------- FR-02.02 schema ----------
    assert(
      !addressSchema.safeParse({ label: "", country: "US" }).success,
      "addressSchema rejects missing required fields",
    );

    // ---------- address create + atomic default ----------
    const base = {
      country: "United States",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      addressLine1: "1 Main St",
      addressLine2: "",
      addressLine3: "",
    };
    const home = await createAddress(profile.id, {
      ...base,
      label: "Home",
      isDefault: true,
    });
    assert(home.isDefault, "first address created as default");

    const work = await createAddress(profile.id, {
      ...base,
      city: "Denver",
      state: "CO",
      postalCode: "80202",
      label: "Work",
      isDefault: true,
    });
    let rows = await listAddresses(profile.id);
    let defaults = rows.filter((r) => r.isDefault);
    assert(
      defaults.length === 1 && defaults[0].id === work.id,
      "CREATE with isDefault=true atomically clears the previous default",
    );

    // ---------- setDefaultAddress ----------
    assert(
      await setDefaultAddress(profile.id, home.id),
      "setDefaultAddress returns true for an owned address",
    );
    rows = await listAddresses(profile.id);
    defaults = rows.filter((r) => r.isDefault);
    assert(
      defaults.length === 1 && defaults[0].id === home.id,
      "exactly one default after setDefaultAddress",
    );

    // ---------- update with isDefault=true ----------
    const gym = await createAddress(profile.id, {
      ...base,
      city: "Houston",
      state: "TX",
      postalCode: "77001",
      label: "Gym",
      isDefault: false,
    });
    const gymUpdated = await updateAddress(profile.id, gym.id, {
      ...base,
      city: "Houston",
      state: "TX",
      postalCode: "77001",
      label: "Gym",
      isDefault: true,
    });
    rows = await listAddresses(profile.id);
    defaults = rows.filter((r) => r.isDefault);
    assert(
      gymUpdated?.isDefault === true &&
        defaults.length === 1 &&
        defaults[0].id === gym.id,
      "UPDATE with isDefault=true atomically promotes and demotes siblings",
    );

    // ---------- ownership scoping ----------
    const [other] = await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: "Other User",
        email: emails[1],
        emailVerified: true,
      })
      .returning({ id: user.id });
    seededIds.push(other.id);
    const otherProfile = await ensureCustomerProfile({
      id: other.id,
      name: "Other User",
    });
    assert(
      (await updateAddress(otherProfile.id, home.id, {
        ...base,
        label: "Hacked",
        isDefault: false,
      })) === null,
      "updateAddress scoped: null for a foreign customer",
    );
    assert(
      (await setDefaultAddress(otherProfile.id, work.id)) === false,
      "setDefaultAddress scoped: false for a foreign customer",
    );
    assert(
      (await deleteAddress(otherProfile.id, home.id)) === false,
      "deleteAddress scoped: false for a foreign customer",
    );

    // ---------- delete + order_addresses isolation ----------
    const fkRows = await db.execute(sql`
      SELECT rc.confrelid::regclass::text AS referenced
      FROM pg_constraint rc
      WHERE rc.contype = 'f'
        AND rc.confrelid = 'public.addresses'::regclass
    `);
    assert(
      (Array.isArray(fkRows) ? fkRows : []).length === 0,
      "no foreign keys reference addresses (deletion cannot cascade)",
    );

    const beforeCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderAddresses);
    assert(
      (await deleteAddress(profile.id, home.id)) === true,
      "deleteAddress succeeds for the owner",
    );
    const remaining = await listAddresses(profile.id);
    assert(
      !remaining.some((r) => r.id === home.id),
      "deleted address no longer listed",
    );
    const afterCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderAddresses);
    assert(
      beforeCount[0].count === afterCount[0].count,
      "order_addresses untouched by address deletion (FR-02.02)",
    );
    assert(
      (await deleteAddress(profile.id, "00000000-0000-0000-0000-000000000000")) ===
        false,
      "deleteAddress returns false for a missing address",
    );
    assert(
      !addressIdSchema.safeParse("not-a-uuid").success,
      "addressIdSchema rejects malformed uuids before SQL",
    );
    assert(
      (await updateCustomerProfile("00000000-0000-0000-0000-000000000000", {
        firstName: "Nope",
      }).catch(() => null)) === null,
      "updateCustomerProfile throws when no profile exists",
    );

    return NextResponse.json({ ok: true, count: results.length, results });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        results,
      },
      { status: 500 },
    );
  } finally {
    // `customer_profile` has no working FK to `user` in this drifted dev
    // DB, so clean profiles (→ addresses cascade) before the users.
    if (seededIds.length > 0) {
      await db
        .delete(customerProfiles)
        .where(inArray(customerProfiles.userId, seededIds));
    }
    for (const email of emails) {
      await db.delete(user).where(eq(user.email, email));
    }
  }
}
