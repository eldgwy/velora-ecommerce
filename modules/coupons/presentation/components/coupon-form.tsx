"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  createCouponAction,
  updateCouponAction,
} from "@/modules/coupons/presentation/actions/coupon-admin.actions";
import type { CouponDetail } from "@/modules/coupons/application/queries/coupons";

/**
 * Coupon create/edit form. All validation and authorization live server-side;
 * this form only collects intent and surfaces the server's message.
 */
export function CouponForm({ initial }: { initial?: CouponDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<"PERCENTAGE" | "FIXED">(initial?.type ?? "PERCENTAGE");

  const onSubmit = (form: FormData) => {
    const payload = {
      ...(initial ? { id: initial.id } : {}),
      code: String(form.get("code") ?? ""),
      type,
      value: String(form.get("value") ?? ""),
      minimumOrderAmount: String(form.get("minimumOrderAmount") ?? ""),
      maximumDiscountAmount: String(form.get("maximumDiscountAmount") ?? ""),
      usageLimit: String(form.get("usageLimit") ?? ""),
      perUserLimit: String(form.get("perUserLimit") ?? ""),
      startsAt: String(form.get("startsAt") ?? ""),
      expiresAt: String(form.get("expiresAt") ?? ""),
      isActive: form.get("isActive") === "on",
    };
    startTransition(async () => {
      const res = initial
        ? await updateCouponAction(payload)
        : await createCouponAction(payload);
      if (res.ok) {
        toast.success(initial ? "Coupon updated." : "Coupon created.");
        router.push("/admin/coupons");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // Stored walls are UTC; render them as UTC so the submit path (which
  // interprets input as UTC) round-trips without a timezone shift.
  const toLocalInput = (d: Date | null) => {
    if (!d) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            name="code"
            defaultValue={initial?.code ?? ""}
            placeholder="SUMMER10"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Uppercase A–Z, 0–9, dash, underscore · 3–32 chars.</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="type">Discount type</Label>
          <select
            id="type"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as "PERCENTAGE" | "FIXED")}
            aria-label="Discount type"
          >
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="value">{type === "PERCENTAGE" ? "Percent (0–100)" : "Amount (USD)"}</Label>
          <Input id="value" name="value" defaultValue={initial?.value ?? ""} placeholder={type === "PERCENTAGE" ? "10" : "5.00"} inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="minimumOrderAmount">Minimum subtotal (USD, optional)</Label>
          <Input
            id="minimumOrderAmount"
            name="minimumOrderAmount"
            defaultValue={initial?.minimumOrderAmount ?? ""}
            placeholder="0.00"
            inputMode="decimal"
          />
        </div>
        {type === "PERCENTAGE" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="maximumDiscountAmount">Max discount (USD, optional)</Label>
            <Input
              id="maximumDiscountAmount"
              name="maximumDiscountAmount"
              defaultValue={initial?.maximumDiscountAmount ?? ""}
              placeholder="No cap"
              inputMode="decimal"
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor="usageLimit">Global usage limit (optional)</Label>
          <Input
            id="usageLimit"
            name="usageLimit"
            defaultValue={initial?.usageLimit?.toString() ?? ""}
            placeholder="Unlimited"
            inputMode="numeric"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="perUserLimit">Per-user limit (optional)</Label>
          <Input
            id="perUserLimit"
            name="perUserLimit"
            defaultValue={initial?.perUserLimit?.toString() ?? ""}
            placeholder="Unlimited"
            inputMode="numeric"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="startsAt">Starts at, UTC (optional)</Label>
          <Input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalInput(initial?.startsAt ? new Date(initial.startsAt) : null)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="expiresAt">Expires at, UTC (optional)</Label>
          <Input
            id="expiresAt"
            name="expiresAt"
            type="datetime-local"
            defaultValue={toLocalInput(initial?.expiresAt ? new Date(initial.expiresAt) : null)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial?.isActive ?? true}
            className="size-4"
          />
          Active
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} type="submit">
          {pending ? <Spinner className="size-4" /> : null}
          {initial ? "Save changes" : "Create coupon"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => router.back()}>
          Back
        </Button>
      </div>
      {initial ? (
        <p className="text-xs text-muted-foreground">
          Past orders keep their frozen discounts — edits never rewrite financial history. A limit
          below the {initial.usageCount} recorded uses is rejected; deactivate instead.
        </p>
      ) : null}
    </form>
  );
}
