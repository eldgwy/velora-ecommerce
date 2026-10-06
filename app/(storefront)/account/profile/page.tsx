import type { Metadata } from "next";

import { requireSession } from "@/shared/lib/guards";
import { toDateInputValue } from "@/shared/lib/format";
import { ensureCustomerProfile } from "@/services/customer.service";
import { listAddresses } from "@/services/address.service";
import ProfileForm from "./ProfileForm";
import AddressBook from "./AddressBook";

export const metadata: Metadata = {
  title: "Profile",
};

/**
 * FR-02.01 / FR-02.02 — Customer profile inspection & update plus the
 * address book. The proxy and `requireSession` both enforce a signed-in,
 * active session.
 */
export default async function ProfilePage() {
  const session = await requireSession("/account/profile");

  // Lazy-creates the profile row for accounts registered before a
  // `customer_profile` record existed (see ensureCustomerProfile).
  const profile = await ensureCustomerProfile(session.user);
  const addresses = await listAddresses(profile.id);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          Profile
        </h1>
        <p className="text-muted-foreground">
          Manage your personal details and saved addresses.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <ProfileForm
          email={session.user.email}
          profile={{
            firstName: profile.firstName,
            middleName: profile.middleName ?? "",
            lastName: profile.lastName,
            phone: profile.phone ?? "",
            birthday: toDateInputValue(profile.birthday),
            preferredLanguage: profile.preferredLanguage === "ar" ? "ar" : "en",
          }}
        />

        <AddressBook addresses={addresses} />
      </div>
    </main>
  );
}
