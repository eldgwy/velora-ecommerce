"use client";

import { useCallback, useEffect, useRef, useState, type TransitionStartFunction } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatMinorUnits } from "@/modules/checkout/domain/money";
import {
  placeOrderAction,
  previewCheckoutAction,
} from "@/modules/checkout/presentation/actions/checkout.actions";
import type { CheckoutResult } from "@/modules/checkout/application/commands/create-order";
import type { CheckoutPreview } from "@/modules/checkout/application/queries/checkout-preview";

interface CheckoutReviewProps {
  buildInput: () => {
    shippingAddress: { addressId: string } | { newAddress: Record<string, string | undefined> };
    billingAddress:
      | { sameAsShipping: true }
      | { addressId: string }
      | { newAddress: Record<string, string | undefined> };
    shippingMethod: "STANDARD" | "EXPRESS";
    couponCode: string | null;
    contactPhone: string | null;
    paymentMethod: "card" | "cod";
    notes: null;
  };
  attemptKey: () => string;
  startPlacing: TransitionStartFunction;
  placing: boolean;
  failure: { message: string; code?: string } | null;
  setFailure: (f: { message: string; code?: string } | null) => void;
  onPlaced: (order: CheckoutResult) => void;
  onConflictRefresh: () => Promise<void>;
}

/**
 * Review step: loads a server-authoritative preview, places the order with
 * the previewed total echoed for confirmation, and handles drift.
 *
 * If prices, stock, shipping, tax, or promotions move between preview and
 * placement, the server aborts with TOTAL_CHANGED (nothing persisted) and
 * this step shows the fresh breakdown with an explicit confirm control.
 * Confirming re-places against the latest preview total — the client never
 * sets the charged amount.
 */
export function CheckoutReview({
  buildInput,
  attemptKey,
  startPlacing,
  placing,
  failure,
  setFailure,
  onPlaced,
  onConflictRefresh,
}: CheckoutReviewProps) {
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [changedTotal, setChangedTotal] = useState<CheckoutPreview | null>(null);
  const signatureRef = useRef<string>("");

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setChangedTotal(null);
    const res = await previewCheckoutAction(buildInput());
    if (res.ok && res.data) {
      setPreview(res.data);
      setFailure(null);
    } else {
      setPreview(null);
      setFailure({ message: res.ok ? "Could not preview totals." : res.error, code: res.ok ? undefined : res.code });
      if (!res.ok && (res.code === "CART_CONFLICT" || res.code === "STOCK_CONFLICT")) {
        await onConflictRefresh();
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load once per review entry; refresh explicitly afterwards so background
  // input edits cannot silently swap the confirmed breakdown.
  useEffect(() => {
    const signature = JSON.stringify(buildInput());
    if (signatureRef.current !== signature) {
      signatureRef.current = signature;
      void loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const place = (expectedTotalCents: number | undefined, onDone?: () => void) => {
    setFailure(null);
    startPlacing(async () => {
      const res = await placeOrderAction(buildInput(), attemptKey(), expectedTotalCents);
      if (res.ok) {
        onPlaced(res.data);
        toast.success(`Order ${res.data.orderNumber} placed.`);
        onDone?.();
        return;
      }
      if (res.code === "TOTAL_CHANGED") {
        // Refresh the breakdown and require explicit reconfirmation.
        const fresh = await previewCheckoutAction(buildInput());
        if (fresh.ok && fresh.data) {
          setPreview(fresh.data);
          setChangedTotal(fresh.data);
        }
        setFailure({ message: res.error, code: res.code });
        return;
      }
      setFailure({ message: res.error, code: res.code });
      if (res.code === "CART_CONFLICT" || res.code === "STOCK_CONFLICT") {
        await onConflictRefresh();
      }
      onDone?.();
    });
  };

  if (loading && !preview) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-10 ring-1 ring-foreground/10" aria-busy="true" aria-label="Loading preview">
        <Spinner className="size-6" />
        <p className="text-sm text-muted-foreground">Calculating your total on the server…</p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <p className="text-sm font-semibold">We couldn&apos;t preview your total</p>
        <p className="text-xs text-muted-foreground">{failure?.message ?? "Please try again."}</p>
        <Button size="sm" variant="outline" onClick={() => void loadPreview()}>
          Retry preview
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Final review">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Review & place order</h2>
          <Button size="xs" variant="ghost" disabled={loading} onClick={() => void loadPreview()}>
            {loading ? <Spinner className="size-3" /> : null}
            Refresh totals
          </Button>
        </div>

        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {preview.lines.map((l) => (
            <li key={l.variantId} className="flex justify-between gap-2">
              <span className="text-muted-foreground">× {l.quantity}</span>
              <span className="font-medium">{formatMinorUnits(l.lineSubtotalCents, preview.currency)}</span>
            </li>
          ))}
        </ul>
        <Separator className="my-3" />
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-medium">{formatMinorUnits(preview.subtotalCents, preview.currency)}</dd>
          </div>
          {preview.promotionDiscountCents > 0 ? (
            <div className="flex justify-between text-primary">
              <dt>Promotions</dt>
              <dd>−{formatMinorUnits(preview.promotionDiscountCents, preview.currency)}</dd>
            </div>
          ) : null}
          {preview.couponDiscountCents > 0 ? (
            <div className="flex justify-between text-primary">
              <dt>Coupon{preview.couponCode ? ` (${preview.couponCode})` : ""}</dt>
              <dd>−{formatMinorUnits(preview.couponDiscountCents, preview.currency)}</dd>
            </div>
          ) : null}
          {!preview.couponValid && preview.couponCode ? (
            <p className="text-xs text-destructive">
              {preview.couponMessage ?? "Coupon does not apply."} Continuing without it.
            </p>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Delivery ({preview.shippingMethod})</dt>
            <dd className="font-medium">{formatMinorUnits(preview.shippingCents, preview.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Tax{preview.taxConfigured ? ` (${preview.taxJurisdiction}, ${(preview.taxRateBps / 100).toFixed(2)}%)` : " (not configured)"}
            </dt>
            <dd className="font-medium">{formatMinorUnits(preview.taxCents, preview.currency)}</dd>
          </div>
          {!preview.taxConfigured ? (
            <p className="text-xs text-muted-foreground">
              No tax rule applies to this destination yet — tax is shown as zero and recorded as such.
            </p>
          ) : null}
          {!preview.weightKnown ? (
            <p className="text-xs text-muted-foreground">
              Parcel weight is unavailable, so weight-limited rates were skipped.
            </p>
          ) : null}
          <Separator className="my-1" />
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatMinorUnits(preview.totalCents, preview.currency)} {preview.currency}</dd>
          </div>
        </dl>
      </section>

      {changedTotal ? (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
          <p className="text-sm font-semibold">The total changed to {formatMinorUnits(changedTotal.totalCents, changedTotal.currency)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Prices, stock, shipping, or promotions moved since your preview. Nothing has been
            charged — review the new breakdown above and confirm explicitly.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={placing}
              onClick={() => place(changedTotal.totalCents)}
            >
              {placing ? <Spinner className="size-4" /> : null}
              Confirm new total
            </Button>
            <Button size="sm" variant="outline" onClick={() => setChangedTotal(null)}>
              Keep reviewing
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="lg"
          disabled={placing || loading}
          onClick={() => place(preview.totalCents)}
        >
          {placing ? <Spinner className="size-4" /> : null}
          {placing ? "Placing order…" : `Place order · ${formatMinorUnits(preview.totalCents, preview.currency)}`}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        The server rechecks every figure at placement. Duplicate submissions are safe.
      </p>
    </div>
  );
}
