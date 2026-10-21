import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { formatDate } from "@/shared/lib/format";
import { getUserForAdmin, listUserAdminEvents } from "@/services/user-admin.service";
import { CustomerAdminToggles } from "@/modules/customer/presentation/components/customer-admin-toggles";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Customer — VELORA Admin",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await getUserForAdmin(id);
  if (!account) notFound();

  const events = await listUserAdminEvents(id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{account.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.email} · member since {formatDate(account.createdAt)}
            {account.emailVerified ? "" : " · email unverified"}
          </p>
        </div>
        <Button size="sm" variant="outline" render={<Link href="/admin/customers">Back to list</Link>} />
      </div>

      <CustomerAdminToggles userId={account.id} label={account.email} status={account.status} role={account.role} />

      <section className="flex flex-col gap-1 rounded-xl bg-card p-5 text-sm ring-1 ring-foreground/10">
        <h2 className="text-base font-semibold">Profile</h2>
        {account.profile ? (
          <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
            <span>
              Name: {account.profile.firstName}
              {account.profile.middleName ? ` ${account.profile.middleName}` : ""} {account.profile.lastName}
            </span>
            <span>Phone: {account.profile.phone ?? "—"}</span>
            <span>Language: {account.profile.preferredLanguage ?? "—"}</span>
            <span>Birthday: {formatDate(account.profile.birthday)}</span>
          </div>
        ) : (
          <p className="text-muted-foreground">No customer profile row (created lazily on first account use).</p>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 className="text-base font-semibold">Admin audit trail</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status or role changes recorded.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{e.eventType.replace("_", " ").toLowerCase()}</strong>
                  <span className="mx-2 text-muted-foreground">
                    {e.previousValue ?? "—"} → {e.newValue}
                  </span>
                  {e.reason ? <span className="text-xs text-muted-foreground">“{e.reason}”</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  by {e.actorId} · {formatDate(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Deletion and anonymization follow the separate, product-owner-gated GDPR flow (T-2.4); it is
        intentionally not offered here.
      </p>
    </div>
  );
}
