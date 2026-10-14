"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Stripe, StripeElements } from "@stripe/stripe-js";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { getPaymentConfigAction } from "@/modules/checkout/presentation/actions/checkout.actions";

/**
 * Card + wallet payment via Stripe Elements. Rendered only when the server
 * has issued a client secret for this order. Wallet methods (Apple Pay /
 * Google Pay) appear automatically inside the Payment Element whenever the
 * Stripe account enables them and the device supports them — no per-wallet
 * code paths exist here or server-side.
 *
 * Security: only the publishable key and client secret enter the browser
 * (both public by design). Amounts are never sent from the client; the
 * PaymentIntent was created server-side from the persisted order total.
 * Success is never assumed here — the order finalizes exclusively through
 * the verified webhook.
 */
export function StripePaymentForm({
  orderId,
  orderNumber,
  clientSecret,
}: {
  orderId: string;
  orderNumber: string;
  clientSecret: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await getPaymentConfigAction();
      if (cancelled) return;
      if (!config.ok || !config.data?.publishableKey) {
        setUnavailable("Card payments are not configured yet.");
        return;
      }
      try {
        const { loadStripe } = await import("@stripe/stripe-js");
        const stripe = await loadStripe(config.data.publishableKey);
        if (cancelled) return;
        if (!stripe) {
          setUnavailable("Card payments failed to load.");
          return;
        }
        stripeRef.current = stripe;
        const elements = stripe.elements({ clientSecret });
        elementsRef.current = elements;
        const paymentElement = elements.create("payment");
        if (mountRef.current) {
          paymentElement.mount(mountRef.current);
          setReady(true);
        }
      } catch {
        if (!cancelled) setUnavailable("Card payments failed to load.");
      }
    })();
    return () => {
      cancelled = true;
      elementsRef.current?.getElement("payment")?.destroy();
      elementsRef.current = null;
    };
  }, [clientSecret]);

  const onPay = async () => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setPaying(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/account/orders/${orderId}`,
      },
    });
    setPaying(false);
    // A redirect means Stripe accepted the payment; the webhook finalizes.
    // Landing here means validation failed client-side — surface it only.
    if (error) {
      toast.error(error.message ?? "Payment could not be confirmed.");
    }
  };

  if (unavailable) {
    return <p className="text-xs text-muted-foreground">{unavailable}</p>;
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div ref={mountRef} aria-label={`Card payment for order ${orderNumber}`} aria-busy={!ready} />
      {!ready ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-4" /> Loading secure payment form…
        </div>
      ) : null}
      <Button size="lg" disabled={!ready || paying} onClick={onPay}>
        {paying ? <Spinner className="size-4" /> : null}
        {paying ? "Confirming…" : "Pay now"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Card details go directly to Stripe. Wallets appear automatically on supported devices.
      </p>
    </div>
  );
}
