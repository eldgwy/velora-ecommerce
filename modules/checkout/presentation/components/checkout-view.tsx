"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Separator } from "@/shared/components/ui/separator";
import { Spinner } from "@/shared/components/ui/spinner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { formatPrice } from "@/shared/lib/utils";
import {
  getCheckoutDataAction,
  placeOrderAction,
  retryPaymentAction,
} from "@/modules/checkout/presentation/actions/checkout.actions";
import type { CheckoutResult } from "@/modules/checkout/application/commands/create-order";
import type { CheckoutSummary } from "@/modules/checkout/application/queries/checkout-summary";

interface CheckoutViewProps {
  initial: CheckoutSummary;
}

type BillingMode = "same" | "saved" | "new";

function newAddressFields() {
  return {
    country: "US",
    city: "",
    state: "",
    postalCode: "",
    addressLine1: "",
    addressLine2: "",
  };
}

/**
 * Single-page checkout: address → shipping → coupon → review → place order.
 * The client only collects references (address ids, method ids, coupon code);
 * every charge is server-calculated. One idempotency key per attempt guards
 * double-clicks and retries; the server is the correctness backstop.
 */
export function CheckoutView({ initial }: CheckoutViewProps) {
  const [summary, setSummary] = useState<CheckoutSummary>(initial);
  const [shipAddrId, setShipAddrId] = useState<string>(
    initial.addresses.find((a) => a.isDefault)?.id ?? initial.addresses[0]?.id ?? "new",
  );
  const [shipNew, setShipNew] = useState(newAddressFields());
  const [billingMode, setBillingMode] = useState<BillingMode>("same");
  const [billAddrId, setBillAddrId] = useState<string>(initial.addresses[0]?.id ?? "");
  const [billNew, setBillNew] = useState(newAddressFields());
  const [shippingMethod, setShippingMethod] = useState<"STANDARD" | "EXPRESS">("STANDARD");
  const [couponCode, setCouponCode] = useState("");
  const [contactPhone, setContactPhone] = useState(initial.contactPhone ?? "");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cod">("cod");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const [placing, startPlacing] = useTransition();
  const [retrying, startRetrying] = useTransition();

  // One key per attempt payload: any input change mints a fresh key so a
  // failed attempt's key is never reused with different details.
  const formSignature = useMemo(
    () =>
      JSON.stringify([
        shipAddrId, shipNew, billingMode, billAddrId, billNew,
        shippingMethod, couponCode, contactPhone, paymentMethod,
      ]),
    [shipAddrId, shipNew, billingMode, billAddrId, billNew, shippingMethod, couponCode, contactPhone, paymentMethod],
  );
  const keyRef = useRef<{ signature: string; key: string } | null>(null);
  const attemptKey = (): string => {
    if (!keyRef.current || keyRef.current.signature !== formSignature) {
      keyRef.current = { signature: formSignature, key: crypto.randomUUID() };
    }
    return keyRef.current.key;
  };

  const buildInput = () => ({
    shippingAddress:
      shipAddrId === "new"
        ? {
            newAddress: {
              ...shipNew,
              addressLine1: shipNew.addressLine1 || undefined,
              addressLine2: shipNew.addressLine2 || undefined,
            },
          }
        : { addressId: shipAddrId },
    billingAddress:
      billingMode === "same"
        ? { sameAsShipping: true as const }
        : billingMode === "saved"
          ? { addressId: billAddrId }
          : {
              newAddress: {
                ...billNew,
                addressLine1: billNew.addressLine1 || undefined,
                addressLine2: billNew.addressLine2 || undefined,
              },
            },
    shippingMethod,
    couponCode: couponCode.trim() === "" ? null : couponCode,
    contactPhone: contactPhone.trim() === "" ? null : contactPhone,
    paymentMethod,
    notes: null,
  });

  const handlePlaceOrder = () => {
    setFailure(null);
    startPlacing(async () => {
      const res = await placeOrderAction(buildInput(), attemptKey());
      if (res.ok) {
        setResult(res.data);
        toast.success(`Order ${res.data.orderNumber} placed.`);
      } else {
        setFailure({ message: res.error, code: res.code });
        if (res.code === "CART_CONFLICT" || res.code === "STOCK_CONFLICT") {
          const fresh = await getCheckoutDataAction();
          if (fresh.ok && fresh.data) setSummary(fresh.data);
        }
      }
    });
  };

  const handleRetryPayment = (orderId: string) => {
    startRetrying(async () => {
      const res = await retryPaymentAction(orderId);
      if (res.ok) {
        toast.success("Payment initialization updated.");
        const fresh = await getCheckoutDataAction();
        void fresh;
      } else {
        toast.error(res.error);
      }
    });
  };

  if (result) {
    return (
      <Confirmation
        result={result}
        onRetryPayment={() => handleRetryPayment(result.orderId)}
        retrying={retrying}
      />
    );
  }

  const { detail, validation } = summary;
  if (detail.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
        <h1 className="text-2xl font-semibold">Nothing to check out</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your bag is empty. Add some pieces before checking out.
        </p>
        <Button size="lg" render={<Link href="/products">Continue shopping</Link>} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">Checkout</h1>

        {!validation.valid ? (
          <div className="rounded-xl bg-destructive/5 p-4 ring-1 ring-destructive/20">
            <p className="text-sm font-semibold text-destructive">
              Your bag needs attention before you can pay
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {validation.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-2" render={<Link href="/cart">Review bag</Link>} />
          </div>
        ) : null}

        {failure ? (
          <div className="rounded-xl bg-destructive/5 p-4 ring-1 ring-destructive/20">
            <p className="text-sm font-semibold text-destructive">Checkout failed</p>
            <p className="text-xs text-muted-foreground">{failure.message}</p>
            {failure.code === "COUPON_INVALID" ? null : (
              <p className="mt-1 text-xs text-muted-foreground">
                {failure.code === "STOCK_CONFLICT"
                  ? "Start a new attempt after reviewing your bag — your previous key is spent."
                  : "You can safely retry; duplicate orders are prevented."}
              </p>
            )}
          </div>
        ) : null}

        <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Delivery address">
          <h2 className="mb-3 text-base font-semibold">1 · Delivery address</h2>
          <div className="flex flex-col gap-2">
            {summary.addresses.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-muted">
                <input
                  type="radio"
                  name="ship-addr"
                  checked={shipAddrId === a.id}
                  onChange={() => setShipAddrId(a.id)}
                  className="mt-1 accent-(--primary)"
                />
                <span className="text-sm">
                  <span className="font-medium">{a.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {a.addressLine1 ?? ""} {a.city}, {a.state} {a.postalCode} · {a.country}
                  </span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted">
              <input
                type="radio"
                name="ship-addr"
                checked={shipAddrId === "new"}
                onChange={() => setShipAddrId("new")}
                className="accent-(--primary)"
              />
              <span className="text-sm font-medium">Use a new address</span>
            </label>
          </div>
          {shipAddrId === "new" ? (
            <AddressForm value={shipNew} onChange={setShipNew} prefix="ship" />
          ) : null}
          <div className="mt-3">
            <Label htmlFor="contact-phone">Contact phone (E.164, optional)</Label>
            <Input
              id="contact-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+15551234567"
              inputMode="tel"
            />
          </div>
        </section>

        <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Billing address">
          <h2 className="mb-3 text-base font-semibold">2 · Billing address</h2>
          <div className="flex flex-wrap gap-2">
            {(["same", "saved", "new"] as BillingMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={billingMode === m ? "default" : "outline"}
                onClick={() => setBillingMode(m)}
              >
                {m === "same" ? "Same as delivery" : m === "saved" ? "Saved address" : "New address"}
              </Button>
            ))}
          </div>
          {billingMode === "saved" ? (
            <select
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={billAddrId}
              onChange={(e) => setBillAddrId(e.target.value)}
              aria-label="Billing address"
            >
              {summary.addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.city}, {a.country}
                </option>
              ))}
            </select>
          ) : null}
          {billingMode === "new" ? (
            <AddressForm value={billNew} onChange={setBillNew} prefix="bill" />
          ) : null}
        </section>

        <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Shipping method">
          <h2 className="mb-3 text-base font-semibold">3 · Delivery speed</h2>
          <div className="flex flex-col gap-2">
            {summary.shippingMethods.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted">
                <input
                  type="radio"
                  name="ship-method"
                  checked={shippingMethod === m.id}
                  onChange={() => setShippingMethod(m.id)}
                  className="accent-(--primary)"
                />
                <span className="text-sm font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.etaDays}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Standard delivery is free over {formatPrice("75.00")}. Final charges are calculated on the server.
          </p>
        </section>

        <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Coupon and payment">
          <h2 className="mb-3 text-base font-semibold">4 · Coupon & payment</h2>
          <div className="flex gap-2">
            <Input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="Coupon code (optional)"
              aria-label="Coupon code"
              className="uppercase"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={paymentMethod === "cod" ? "default" : "outline"}
              onClick={() => setPaymentMethod("cod")}
            >
              Cash on delivery
            </Button>
            <Button
              size="sm"
              variant={paymentMethod === "card" ? "default" : "outline"}
              onClick={() => setPaymentMethod("card")}
            >
              Card (Stripe)
            </Button>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10 lg:sticky lg:top-6">
        <h2 className="text-base font-semibold">Order summary</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {detail.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {i.productName} × {i.quantity}
              </span>
              <span className="font-medium">{formatPrice(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <Separator />
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatPrice(detail.subtotal)}</dd>
          </div>
          {Number(detail.discountTotal) > 0 ? (
            <div className="flex justify-between text-primary">
              <dt>Promotions</dt>
              <dd>−{formatPrice(detail.discountTotal)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-xs text-muted-foreground">
            <dt>Shipping & taxes</dt>
            <dd>at checkout</dd>
          </div>
        </dl>
        <Button size="lg" disabled={placing || !validation.valid} onClick={handlePlaceOrder}>
          {placing ? <Spinner className="size-4" /> : null}
          {placing ? "Placing order…" : "Place order"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Totals are calculated on the server at order time. Duplicate submissions are safe.
        </p>
      </aside>
    </div>
  );
}

function AddressForm({
  value,
  onChange,
  prefix,
}: {
  value: ReturnType<typeof newAddressFields>;
  onChange: (v: ReturnType<typeof newAddressFields>) => void;
  prefix: string;
}) {
  const set = (k: keyof typeof value) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <Label htmlFor={`${prefix}-line1`}>Street address</Label>
        <Input id={`${prefix}-line1`} value={value.addressLine1} onChange={set("addressLine1")} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-city`}>City</Label>
        <Input id={`${prefix}-city`} value={value.city} onChange={set("city")} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-state`}>State / region</Label>
        <Input id={`${prefix}-state`} value={value.state} onChange={set("state")} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-postal`}>Postal code</Label>
        <Input id={`${prefix}-postal`} value={value.postalCode} onChange={set("postalCode")} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-country`}>Country (2–3 letters)</Label>
        <Input id={`${prefix}-country`} value={value.country} onChange={set("country")} className="uppercase" />
      </div>
    </div>
  );
}

function Confirmation({
  result,
  onRetryPayment,
  retrying,
}: {
  result: CheckoutResult;
  onRetryPayment: () => void;
  retrying: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-xl bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
      <p className="text-sm font-semibold tracking-[0.2em] text-primary">VELORA</p>
      <h1 className="text-2xl font-semibold">Order {result.orderNumber} confirmed</h1>
      <p className="text-sm text-muted-foreground">
        Total {formatPrice(result.total)} {result.currency}
        {result.replayed ? " · recovered from your previous attempt" : ""}.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Badge variant="secondary">Stock reserved</Badge>
        {result.payment.provider === "cod" ? (
          <Badge variant="secondary">Pay on delivery</Badge>
        ) : result.payment.clientSecret ? (
          <Badge variant="secondary">Card payment ready</Badge>
        ) : (
          <Badge variant="outline">Payment pending</Badge>
        )}
      </div>
      {result.payment.provider === "stripe" && result.payment.paymentRequired && !result.payment.clientSecret ? (
        <div className="flex flex-col items-center gap-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {result.payment.configurationMissing
              ? "Card payments are not configured yet — your reservation is held. Retry once enabled."
              : "Payment initialization did not return a client secret."}
          </p>
          <Button size="sm" variant="outline" disabled={retrying} onClick={onRetryPayment}>
            {retrying ? <Spinner className="size-4" /> : null}
            Retry payment
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        A confirmation email follows once payment completes. Payment status is confirmed only by the server —
        never by this screen alone.
      </p>
      <Button size="lg" render={<Link href="/products">Continue shopping</Link>} />
    </div>
  );
}
