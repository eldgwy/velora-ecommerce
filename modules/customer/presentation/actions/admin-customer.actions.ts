"use server";

import { requireAdmin } from "@/shared/lib/guards";
import { logger } from "@/shared/lib/logging/logger";
import type { ActionResult } from "@/shared/types/actions";
import {
  setUserRole,
  setUserStatus,
} from "@/services/user-admin.service";
import {
  adminUserStatusToggleSchema,
  adminUserRoleToggleSchema,
} from "@/modules/customer/presentation/schemas/admin-user";

/**
 * Customer-admin account operations (GP-25 / T-2.3). Both actions are
 * admin-gated server-side, take the acting admin id from the verified
 * session (never from the client), and persist an audit event inside the
 * service transaction. Self-changes are rejected by the service to prevent
 * an admin from locking themselves out of the console.
 */
export async function setCustomerStatusAction(
  input: unknown,
): Promise<ActionResult<void>> {
  const session = await requireAdmin();
  const parsed = adminUserStatusToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const res = await setUserStatus(parsed.data.userId, parsed.data.status, {
      actorId: session.user.id,
      actorType: "admin",
      reason: parsed.data.reason,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  } catch (error) {
    logger.error("Customer status change failed", {
      module: "customer-admin",
      action: "setCustomerStatus",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "That change could not be applied." };
  }
}

export async function setCustomerRoleAction(
  input: unknown,
): Promise<ActionResult<void>> {
  const session = await requireAdmin();
  const parsed = adminUserRoleToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const res = await setUserRole(parsed.data.userId, parsed.data.role, {
      actorId: session.user.id,
      actorType: "admin",
      reason: parsed.data.reason,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  } catch (error) {
    logger.error("Customer role change failed", {
      module: "customer-admin",
      action: "setCustomerRole",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, error: "That change could not be applied." };
  }
}
