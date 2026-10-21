import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/infrastructure/database";
import { customerProfiles } from "@/infrastructure/database/schema/customers";
import { env } from "@/config/env";
import {
  verificationEmailText,
  passwordResetEmailText,
  renderVerificationEmail,
  renderPasswordResetEmail,
  VERIFICATION_EMAIL_SUBJECT,
  PASSWORD_RESET_EMAIL_SUBJECT,
} from "@/shared/lib/mail";
import { enqueueAuthEmail, dispatchAuthEmail } from "@/modules/notifications/application/auth-emails";
import { logger } from "@/shared/lib/logging/logger";
import type { UserRole, UserStatus } from "@/shared/lib/roles";

const isProduction = process.env.NODE_ENV === "production";

// ============================================
// Helpers
// ============================================

/** Path the user lands on once the address has been confirmed. */
const VERIFIED_CALLBACK_PATH = "/login?verified=1";

/**
 * Build the absolute URL of our own branded verification page.
 * The page reads `token` and calls `authClient.verifyEmail({ query: { token } })`.
 */
function buildVerificationUrl(token: string): string {
  const baseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, "");
  const params = new URLSearchParams({
    token,
    callbackURL: VERIFIED_CALLBACK_PATH,
  });

  return `${baseUrl}/verify-email?${params.toString()}`;
}

/**
 * Build the absolute URL of our own branded reset-password page.
 * The page reads `token` and calls `authClient.resetPassword({ token, newPassword })`.
 */
function buildResetPasswordUrl(token: string): string {
  const baseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, "");
  const params = new URLSearchParams({ token });

  return `${baseUrl}/reset-password?${params.toString()}`;
}

// ============================================
// Session lifecycle (FR-01.04)
// ============================================

/**
 * Absolute session lifetime in seconds — matches the "Remember me for
 * 30 days" checkbox and SRS FR-01.02 (`expiresAt = now() + 30 days` when
 * `rememberMe` is true).
 *
 * FR-01.04: BOTH remembered AND non-remembered sessions must last 7 days
 * with sliding renewal. This overrides Better Auth's default of 24h for
 * non-remembered sessions.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Sliding renewal window (FR-01.04): once a session is older than this many
 * seconds, the next `get-session` call extends `expiresAt` back out to a
 * full `SESSION_EXPIRES_IN_SECONDS`. Setting it to the lifetime minus 48h
 * means a session is only renewed during its last 48 hours — exactly the
 * SRS "extend expiresAt by original duration when within 48 hours" rule.
 */
export const SESSION_UPDATE_AGE_SECONDS = SESSION_EXPIRES_IN_SECONDS - 60 * 60 * 48;

/**
 * Remembered session lifetime (30 days). Used only when `rememberMe=true`.
 */
export const REMEMBERED_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;

// ============================================
// Auth
// ============================================

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),

  emailAndPassword: {
    enabled: true,
    // Users must confirm their email address before they can sign in.
    requireEmailVerification: true,
    // Don't create a session on sign-up – the account has to be verified first.
    autoSignIn: false,
    // Password-reset links stay valid for 60 minutes (mirrors the email copy).
    resetPasswordTokenExpiresIn: 60 * 60,
    /**
     * Durable queue (GP-14 / T-3.3): the rendered email is stored in
     * `auth_emails`; the first send is fired from the queue path (lease +
     * retry semantics identical to order notifications). Fire-and-forget so
     * the request never blocks on (or leaks the timing of) the mail server.
     * The message always suggests the same copy whether or not the address
     * exists, to keep account enumeration infeasible.
     */
    sendResetPassword: async ({ user, token }) => {
      void (async () => {
        const firstName = user.name?.trim().split(/\s+/)[0] || "there";
        const id = await enqueueAuthEmail({
          userId: user.id,
          eventType: "PASSWORD_RESET",
          recipientEmail: user.email,
          subject: PASSWORD_RESET_EMAIL_SUBJECT,
          bodyHtml: renderPasswordResetEmail({
            name: firstName,
            email: user.email,
            url: buildResetPasswordUrl(token),
          }),
          bodyText: passwordResetEmailText({
            name: firstName,
            url: buildResetPasswordUrl(token),
          }),
        });
        if (id) await dispatchAuthEmail(id);
      })().catch((error: unknown) => {
        // The queued row (if any) is picked up by the retry worker; losing
        // the dispatch only costs latency, not the link itself.
        logger.error("[auth] Password reset email queue path failed", {
          module: "auth",
          action: "resetEmailQueuePath",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    },
    // FR-01.05: kill every active session the moment the password changes.
    revokeSessionsOnPasswordReset: true,
  },

  /**
   * Session lifecycle (FR-01.04).
   *
   * Both remembered and non-remembered sessions use the same 7-day lifetime
   * with sliding renewal. The `rememberMe` checkbox only controls whether
   * the cookie is persistent (30d) or browser-session (7d) — NOT the DB TTL.
   *
   * DB renewal: `updateAge = expiresIn - 48h` means renewal only happens
   * during the final 48-hour window, exactly the SRS rule.
   */
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    // Disable Better Auth's automatic "dontRememberMe" cookie that forces 24h sessions.
    // We handle cookie maxAge manually in hooks to give 7-day sessions for both cases.
  },

  /**
   * Cookie security configuration (FR-01.06).
   * All auth cookies are httpOnly, secure (in production), sameSite=lax.
   * The session cookie gets custom maxAge via hooks (7d or 30d).
   */
  cookies: {
    sessionToken: {
      name: "better-auth.session_token",
      attributes: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/",
      },
    },
    sessionData: {
      name: "better-auth.session_data",
      attributes: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/",
      },
    },
  },

  /**
   * Expose the RBAC columns that already exist in the `user` table on the
   * session, so the proxy and server guards can read `session.user.role`.
   * `input: false` stops clients from self-assigning roles at sign-up;
   * the DB defaults (`CUSTOMER` / `ACTIVE`) fill them on insert.
   */
  user: {
    additionalFields: {
      role: {
        type: ["CUSTOMER", "STAFF", "ADMIN"] as UserRole[],
        required: false,
        input: false,
        returned: true,
        defaultValue: "CUSTOMER" as UserRole,
      },
      status: {
        type: ["ACTIVE", "NOTACTIVE"] as UserStatus[],
        required: false,
        input: false,
        returned: true,
        defaultValue: "ACTIVE" as UserStatus,
      },
    },
  },

  emailVerification: {
    // Send the verification link automatically right after sign-up.
    sendOnSignUp: true,
    // Verification tokens stay valid for 24 hours (mirrors the email copy).
    expiresIn: 60 * 60 * 24,
    /**
     * Durable queue (GP-14 / T-3.3) — same path as the reset email. Users
     * can request a fresh link from the register screen, the navbar
     * dropdown, or the login form.
     */
    sendVerificationEmail: async ({ user, token }) => {
      void (async () => {
        const firstName = user.name?.trim().split(/\s+/)[0] || "there";
        const id = await enqueueAuthEmail({
          userId: user.id,
          eventType: "VERIFICATION",
          recipientEmail: user.email,
          subject: VERIFICATION_EMAIL_SUBJECT,
          bodyHtml: renderVerificationEmail({
            name: firstName,
            email: user.email,
            url: buildVerificationUrl(token),
          }),
          bodyText: verificationEmailText({
            name: firstName,
            url: buildVerificationUrl(token),
          }),
        });
        if (id) await dispatchAuthEmail(id);
      })().catch((error: unknown) => {
        logger.error("[auth] Verification email queue path failed", {
          module: "auth",
          action: "verificationEmailQueuePath",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    },
  },

  /**
   * Rate limiting (FR-01.03): PostgreSQL-backed rate limits for auth endpoints.
   * - Login: 5 requests per minute per IP
   * - Register: 3 requests per minute per IP
   * - Password reset: 2 requests per hour per IP
   * - Email verification: 3 requests per hour per IP
   */
  rateLimit: {
    enabled: true,
    // Use database storage (requires rate_limit table in schema)
    storage: "database",
    // Default window: 1 minute, max 100 requests (fallback)
    window: 60,
    max: 100,
    // Custom rules for specific endpoints
    customRules: {
      "/sign-in/email": {
        window: 60, // 1 minute
        max: 5, // 5 attempts
      },
      "/sign-up/email": {
        window: 60, // 1 minute
        max: 3, // 3 attempts
      },
      "/reset-password": {
        window: 3600, // 1 hour
        max: 2, // 2 attempts
      },
      "/send-verification-email": {
        window: 3600, // 1 hour
        max: 3, // 3 attempts
      },
    },
  },

  /**
   * Database hooks
   * - FR-01.04: ensure 7-day DB `expiresAt` for ALL sessions
   * - FR-01: create customer profile atomically on user registration
   */
  databaseHooks: {
    session: {
      create: {
        before: async (sessionData) => {
          // sessionData.dontRememberMe is set by Better Auth based on the
          // rememberMe checkbox (false = remember, true = don't remember).
          // We ignore it and always set 7-day DB TTL for both cases.
          const expiresAt = new Date(Date.now() + SESSION_EXPIRES_IN_SECONDS * 1000);
          return { data: { ...sessionData, expiresAt } };
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          // Create customer profile atomically when user is created
          // Split the name into first/last (simple heuristic)
          const nameParts = user.name.trim().split(/\s+/);
          const firstName = nameParts[0] || "Customer";
          const lastName = nameParts.slice(1).join(" ") || "User";

          await db.insert(customerProfiles).values({
            userId: user.id,
            firstName,
            lastName,
            preferredLanguage: "en",
          });
        },
      },
    },
  },

  /**
   * Middleware-style hooks (FR-01.04): set cookie `maxAge` for both
   * remembered (30d) and non-remembered (7d) sessions.
   * Better Auth's default gives `maxAge=undefined` (browser session) for
   * non-remembered; we override to 7 days for sliding renewal to work.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Intercept session creation to remember the user's rememberMe choice
      if (ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email") {
        const body = ctx.body as { rememberMe?: boolean } | undefined;
        const rememberMe = body?.rememberMe ?? false;
        // Store on the auth context for the after hook
        (ctx.context as { _rememberMe?: boolean })._rememberMe = rememberMe;
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // After successful sign-in/sign-up, adjust session cookie maxAge
      const rememberMe = (ctx.context as { _rememberMe?: boolean })._rememberMe ?? false;

      if (ctx.context?.session?.session?.token) {
        const sessionTokenCookie = ctx.context.authCookies?.sessionToken;
        if (sessionTokenCookie) {
          const maxAge = rememberMe
            ? REMEMBERED_SESSION_EXPIRES_IN_SECONDS // 30 days
            : SESSION_EXPIRES_IN_SECONDS; // 7 days

          // Overwrite the session cookie with correct maxAge
          ctx.setCookie(sessionTokenCookie.name, ctx.context.session.session.token, {
            ...sessionTokenCookie.attributes,
            maxAge,
          });
        }

        // Remove dont_remember token so Better Auth's 24h logic doesn't activate
        const dontRememberCookie = ctx.context.authCookies?.dontRememberToken;
        if (dontRememberCookie) {
          ctx.setCookie(dontRememberCookie.name, "", {
            ...dontRememberCookie.attributes,
            maxAge: 0,
          });
        }
      }
    }),
  },

  basePath: "/api/auth",
});