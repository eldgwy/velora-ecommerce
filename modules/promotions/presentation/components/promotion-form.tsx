"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  createPromotionAction,
  updatePromotionAction,
} from "@/modules/promotions/presentation/actions/promotion-admin.actions";
import type { PromotionDetail } from "@/modules/promotions/application/queries/promotions";
import { useState } from "react";

/**
 * Promotion create/edit form. Validation and authorization live server-side;
 * this form only collects intent and surfaces the server's message.
 */
export function PromotionForm({ initial }: { initial?: PromotionDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<"PERCENTAGE" | "FIXED">(initial?.type ?? "PERCENTAGE");

  const onSubmit = (form: FormData) => {
    const payload = {
      ...(initial ? { id: initial.id } : {}),
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      type,
      value: String(form.get("value") ?? ""),
      startsAt: String(form.get("startsAt") ?? ""),
      endsAt: String(form.get("endsAt") ?? ""),
      isActive: form.get("isActive") === "on",
    };
    startTransition(async () => {
      const res = initial
        ? await updatePromotionAction(payload)
        : await createPromotionAction(payload);
      if (res.ok) {
        toast.success(initial ? "Promotion updated." : "Promotion created.");
        router.push(initial ? `/admin/promotions/${initial.id}` : "/admin/promotions");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // Stored walls are UTC; render them as UTC so the submit path (which
  // interprets input as UTC) round-trips without a timezone shift.
  const toInput = (d: Date | null) => {
    if (!d) return "";
    const date = new Date(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={initial?.name ?? ""} placeholder="Summer Sale 10%" autoComplete="off" />
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
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={initial?.description ?? ""}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="value">{type === "PERCENTAGE" ? "Percent (0–100)" : "Amount (USD)"}</Label>
          <Input id="value" name="value" defaultValue={initial?.value ?? ""} placeholder={type === "PERCENTAGE" ? "10" : "5.00"} inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="startsAt">Starts at, UTC (optional)</Label>
          <Input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            defaultValue={toInput(initial?.startsAt ? new Date(initial.startsAt) : null)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="endsAt">Ends at, UTC (optional, blank = open-ended)</Label>
          <Input
            id="endsAt"
            name="endsAt"
            type="datetime-local"
            defaultValue={toInput(initial?.endsAt ? new Date(initial.endsAt) : null)}
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
          {initial ? "Save changes" : "Create promotion"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => router.back()}>
          Back
        </Button>
      </div>
      {initial ? (
        <p className="text-xs text-muted-foreground">
          Past orders keep their frozen prices — edits never rewrite order history.
        </p>
      ) : null}
    </form>
  );
}
