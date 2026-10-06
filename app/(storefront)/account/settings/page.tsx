import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, MailCheckIcon, ShieldCheckIcon } from "lucide-react";

import { requireSession } from "@/shared/lib/guards";
import { formatDate } from "@/shared/lib/format";
import { ensureCustomerProfile } from "@/services/customer.service";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import PreferencesCard from "./PreferencesCard";
import AppearanceCard from "./AppearanceCard";
import SecurityCard from "./SecurityCard";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Account settings hub: identity summary, language & appearance
 * preferences, and password security.
 */
export default async function SettingsPage() {
  const session = await requireSession("/account/settings");
  const profile = await ensureCustomerProfile(session.user);

  const isEmailVerified = session.user.emailVerified === true;
  const role = (session.user as { role?: string | null }).role ?? "CUSTOMER";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          Settings
        </h1>
        <p className="text-muted-foreground">
          Manage your account, preferences and security.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {/* ========== Account ========== */}
        <Card className="rounded-2xl border border-border/60">
          <CardHeader>
            <CardTitle className="text-lg">Account</CardTitle>
            <CardDescription>
              Your identity on Velora. Profile details live on the Profile page.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Email
                </dt>
                <dd className="flex items-center gap-2 break-all font-medium text-foreground">
                  <MailCheckIcon className="size-4 shrink-0 text-velora-emerald" />
                  {session.user.email}
                </dd>
              </div>

              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Status
                </dt>
                <dd>
                  <Badge
                    variant={isEmailVerified ? "secondary" : "outline"}
                    className="gap-1"
                  >
                    <ShieldCheckIcon className="size-3" />
                    {isEmailVerified ? "Verified" : "Unverified"}
                  </Badge>
                </dd>
              </div>

              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Role
                </dt>
                <dd className="font-medium text-foreground">{role}</dd>
              </div>

              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Member since
                </dt>
                <dd className="font-medium text-foreground">
                  {formatDate(profile.createdAt)}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
              <Button
                render={<Link href="/account/profile" />}
                variant="outline"
                size="sm"
              >
                Edit profile &amp; addresses
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ========== Preferences / appearance / security ========== */}
        <PreferencesCard
          language={profile.preferredLanguage === "ar" ? "ar" : "en"}
        />
        <AppearanceCard />
        <SecurityCard />
      </div>
    </main>
  );
}
