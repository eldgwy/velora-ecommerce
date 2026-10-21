"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  setCustomerRoleAction,
  setCustomerStatusAction,
} from "@/modules/customer/presentation/actions/admin-customer.actions";

const ROLES = ["CUSTOMER", "STAFF", "ADMIN"] as const;

/**
 * Account status/role controls for the customer admin detail page. A reason
 * is gathered once and attached to whichever change is submitted — it lands
 * in the durable `user_admin_events` audit row together with the acting
 * admin id.
 */
export function CustomerAdminToggles({
  userId,
  label,
  status,
  role,
}: {
  userId: string;
  /** Human context used in confirms/toasts (name or email). */
  label: string;
  status: "ACTIVE" | "NOTACTIVE";
  role: "ADMIN" | "STAFF" | "CUSTOMER";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const readReason = (form: FormData): string | undefined => {
    const raw = String(form.get("reason") ?? "").trim();
    return raw.length > 0 ? raw : undefined;
  };

  const toggleStatus = (form: FormData) => {
    const nextStatus = status === "ACTIVE" ? "NOTACTIVE" : "ACTIVE";
    const verb = nextStatus === "NOTACTIVE" ? "Disable" : "Re-enable";
    if (!window.confirm(`${verb} account for ${label}? A disabled account is signed out everywhere immediately.`)) {
      return;
    }
    startTransition(async () => {
      const res = await setCustomerStatusAction({ userId, status: nextStatus, reason: readReason(form) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(nextStatus === "NOTACTIVE" ? `Account disabled — ${label} is signed out everywhere.` : `Account re-enabled — ${label} can sign in again.`);
      router.refresh();
    });
  };

  const changeRole = (form: FormData) => {
    const nextRole = String(form.get("role") ?? "");
    if (!ROLES.includes(nextRole as (typeof ROLES)[number]) || nextRole === role) {
      toast.error("Choose a different role first.");
      return;
    }
    startTransition(async () => {
      const res = await setCustomerRoleAction({ userId, role: nextRole, reason: readReason(form) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Role updated to ${nextRole}.`);
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <h2 className="text-base font-semibold">Account controls</h2>
      <form action={toggleStatus} className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          Status: <strong className={status === "ACTIVE" ? "text-velora-emerald" : ""}>{status}</strong>
        </span>
        <Button
          type="submit"
          size="sm"
          variant={status === "ACTIVE" ? "outline" : "default"}
          disabled={pending}
        >
          {status === "ACTIVE" ? "Disable account" : "Re-enable account"}
        </Button>
      </form>
      <form action={changeRole} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="customer-role">Role</Label>
          <select
            id="customer-role"
            name="role"
            defaultValue={role}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Change role
        </Button>
      </form>
      <div className="flex flex-col gap-1">
        <Label htmlFor="customer-reason">Reason (recorded in the audit trail with your admin id)</Label>
        <input
          id="customer-reason"
          name="reason"
          maxLength={320}
          placeholder="e.g. repeated refund abuse (ticket #123)"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          autoComplete="off"
        />
      </div>
      {pending ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Applying…
        </span>
      ) : null}
    </section>
  );
}
