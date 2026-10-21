import { z } from "zod";

import { USER_ADMIN_EVENT_TYPES } from "@/services/user-admin.service";

export const adminUserStatusSchema = z.enum(["ACTIVE", "NOTACTIVE"]);
export const adminUserRoleSchema = z.enum(["ADMIN", "STAFF", "CUSTOMER"]);
export const adminUserEventTypeSchema = z.enum(USER_ADMIN_EVENT_TYPES);

export const adminUserToggleSchema = z
  .object({
    userId: z.string().min(1, "Account is required."),
    reason: z.string().trim().max(320).optional(),
  })
  .strict();

export const adminUserStatusToggleSchema = adminUserToggleSchema.extend({
  status: adminUserStatusSchema,
});

export const adminUserRoleToggleSchema = adminUserToggleSchema.extend({
  role: adminUserRoleSchema,
});

export type AdminUserStatusToggle = z.infer<typeof adminUserStatusToggleSchema>;
export type AdminUserRoleToggle = z.infer<typeof adminUserRoleToggleSchema>;
