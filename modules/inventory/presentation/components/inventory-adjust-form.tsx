"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { adjustInventory } from "@/shared/lib/actions/inventory";

/**
 * Row-level stock correction driving the existing adjustInventory action.
 * The audit reason is FORCED (roadmap T-2.2): without a stated reason the
 * movement row would be forensic-dead. Each movement is persisted with the
 * admin's actor id (migration 0032 columns).
 *
 * Semantics: "adjust" moves on-hand stock up/down with a movement type;
 * "set" pins an absolute on-hand quantity; "fix reservation" reserves or
 * releases against the reserved counter (the movement type follows the
 * direction: type is the label, the action enforces the counters).
 */
export function InventoryAdjustForm({
  variantId,
  label,
}: {
  variantId: string;
  /** Human context shown in toasts ("Atelier Coat · SN-1"). */
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (form: FormData) => {
    const kind = String(form.get("kind") ?? "adjust");
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length === 0) {
      toast.error("A reason is required — it is the audit trail for this change.");
      return;
    }
    const notes = String(form.get("notes") ?? "").trim() || undefined;
    const amountRaw = String(form.get("amount") ?? "").trim();
    const amount = Number(amountRaw);
    if (kind !== "set" && (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0)) {
      toast.error("Amount must be a positive whole number.");
      return;
    }
    if (kind === "set") {
      const quantity = amountRaw;
      if (!Number.isFinite(Number(quantity)) || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) {
        toast.error("Quantity must be a non-negative whole number.");
        return;
      }
      startTransition(async () => {
        const res = await adjustInventory({ kind: "set", variantId, quantity, reason, notes });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Stock set for ${label}.`);
        router.refresh();
      });
      return;
    }
    const direction = String(form.get("direction") ?? "add");
    if (kind === "adjust") {
      const type = String(form.get("type") ?? "RESTOCK");
      const delta = direction === "subtract" ? -amount : amount;
      startTransition(async () => {
        const res = await adjustInventory({ kind: "stock", variantId, delta, type, reason, notes });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Stock ${direction === "subtract" ? "reduced" : "increased"} for ${label}.`);
        router.refresh();
      });
      return;
    }
    // kind === "reservation"
    if (direction === "subtract") {
      startTransition(async () => {
        const res = await adjustInventory({
          kind: "reservation",
          variantId,
          delta: -amount,
          type: "RELEASE",
          reason,
          notes,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Reservation released for ${label}.`);
        router.refresh();
      });
      return;
    }
    startTransition(async () => {
      const res = await adjustInventory({
        kind: "reservation",
        variantId,
        delta: amount,
        type: "RESERVATION",
        reason,
        notes,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Reservation reserved for ${label}.`);
      router.refresh();
    });
  };

  return (
    <form action={onSubmit} className="flex flex-wrap items-end gap-2 text-xs">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`kind-${variantId}`}>Change</Label>
        <select
          id={`kind-${variantId}`}
          name="kind"
          defaultValue="adjust"
          className="rounded border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="adjust">Adjust stock (+/−)</option>
          <option value="set">Set stock to</option>
          <option value="reservation">Fix reservation</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`direction-${variantId}`}>Direction</Label>
        <select
          id={`direction-${variantId}`}
          name="direction"
          defaultValue="add"
          className="rounded border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="add">Add</option>
          <option value="subtract">Subtract</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`amount-${variantId}`}>Amount</Label>
        <Input
          id={`amount-${variantId}`}
          name="amount"
          inputMode="numeric"
          placeholder="0"
          className="w-24 text-xs"
          autoComplete="off"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`type-${variantId}`}>
          <span className="sr-only">Movement type</span>Type
        </Label>
        <select
          id={`type-${variantId}`}
          name="type"
          defaultValue="RESTOCK"
          className="rounded border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="RESTOCK">RESTOCK</option>
          <option value="DAMAGE">DAMAGE</option>
          <option value="ADJUSTMENT">ADJUSTMENT</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`reason-${variantId}`}>Reason (audit)</Label>
        <Input
          id={`reason-${variantId}`}
          name="reason"
          maxLength={140}
          required
          placeholder="Cycle count correction"
          className="w-52 text-xs"
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`notes-${variantId}`}>
          <span className="sr-only">Notes</span>Notes
        </Label>
        <Input
          id={`notes-${variantId}`}
          name="notes"
          maxLength={255}
          className="w-40 text-xs"
          autoComplete="off"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Spinner /> : null} Apply
      </Button>
    </form>
  );
}
