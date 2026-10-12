import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { getCheckoutDataAction } from "@/modules/checkout/presentation/actions/checkout.actions";
import { CheckoutView } from "@/modules/checkout/presentation/components/checkout-view";

// Checkout state is per-user and dynamic: never cache, always server-render.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Checkout — VELORA",
  description: "Review your order and complete your purchase.",
};

export default async function CheckoutPage() {
  const res = await getCheckoutDataAction();

  if (!res.ok || !res.data) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
          <h1 className="text-2xl font-semibold">Sign in to check out</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {res.ok ? "We couldn't load checkout." : res.error}
          </p>
          <Button size="lg" render={<Link href="/login?callbackUrl=/checkout">Sign in</Link>} />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <CheckoutView initial={res.data} />
    </main>
  );
}
