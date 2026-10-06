import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

import type { auth } from "@/shared/lib/auth";

/**
 * Poll the session in the background so FR-01.04's sliding renewal keeps
 * moving `expiresAt` forward while a tab is open (matches the
 * 48-hour renewal window configured server-side).
 */
export const authClient = createAuthClient({
  sessionOptions: {
    // Re-fetch the session every 5 minutes of active use.
    refetchInterval: 60 * 5,
    refetchOnWindowFocus: true,
  },
  /**
   * Teach the client about the server-side `role` / `status` additional
   * fields so `session.user.role` and `session.user.status` are typed
   * (FR-01.06). `typeof auth` is a type-only import — no runtime cycle.
   */
  plugins: [inferAdditionalFields<typeof auth>()],
});
