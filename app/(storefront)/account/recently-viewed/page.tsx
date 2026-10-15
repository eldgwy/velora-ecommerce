import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { requireSession } from "@/shared/lib/guards";
import { getRecentHistory } from "@/modules/recently-viewed/application/queries/history";
import { HistoryRowList } from "@/modules/recently-viewed/presentation/components/history-rows";
import { ClearHistoryButton } from "@/modules/recently-viewed/presentation/components/clear-history-button";
import { MergeGuestHistory } from "@/modules/recently-viewed/presentation/components/merge-guest-history";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recently viewed — VELORA",
  description: "Products you have recently viewed.",
};

/**
 * Customer browsing history: live catalog data, most recent first.
 * Strictly session-scoped; guest entries merge once on arrival, then
 * browser storage clears so shared devices never cross accounts.
 */
export default async function RecentlyViewedPage() {
  const session = await requireSession("/account/recently-viewed");
  const history = await getRecentHistory(session.user.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <MergeGuestHistory />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Recently viewed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {history.itemCount} product{history.itemCount === 1 ? "" : "s"} · prices and
            availability are checked live and may change
          </p>
        </div>
        {history.itemCount > 0 ? <ClearHistoryButton /> : null}
      </div>

      {history.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <h2 className="text-xl font-semibold">Nothing viewed yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Products you look at will appear here for easy revisiting.
          </p>
          <Button size="lg" render={<Link href="/products">Browse products</Link>} />
        </div>
      ) : (
        <div className="mt-6">
          <HistoryRowList items={history.items} heading="Your browsing history" />
        </div>
      )}
      <Separator className="my-6" />
      <p className="text-xs text-muted-foreground">
        Only the fact that you viewed a product is kept — never prices, stock, or browsing behavior.
      </p>
    </main>
  );
}
