import "server-only";

import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { auth } from "@/shared/lib/auth";
import { ADMIN_ROLES, type UserRole } from "@/shared/lib/roles";

// ============================================
// Types
// ============================================

/** A session whose account is active; guards hand this back on success. */
export type GuardedSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

// ============================================
// Server components / server actions
// ============================================

/** Read the current session. Returns `null` for guests and deactivated accounts. */
export async function getCurrentSession(): Promise<GuardedSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session || session.user.status !== "ACTIVE") return null;

  return session;
}

/**
 * Require a signed-in, active account inside a Server Component or Server
 * Action. Redirects guests (and deactivated accounts) to the login page,
 * preserving the current path so they can be sent back afterwards.
 */
export async function requireSession(pathname = "/"): Promise<GuardedSession> {
  const session = await getCurrentSession();

  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
  }

  return session;
}

/**
 * Require one of the given roles (FR-01.06). Unauthenticated visitors are
 * sent to login; signed-in users without the role get the real HTTP 403
 * page (`app/forbidden.tsx`).
 */
export async function requireRole(
  ...roles: UserRole[]
): Promise<GuardedSession> {
  const session = await getCurrentSession();

    if (!session) redirect("/login?callbackUrl=/admin");
  if (!roles.includes(session.user.role as UserRole)) forbidden();

  return session;
}

/** Shorthand for the `/admin/*` surface: `ADMIN` or `STAFF` (FR-01.06). */
export async function requireAdmin(): Promise<GuardedSession> {
  return requireRole(...ADMIN_ROLES);
}

// ============================================
// Route handlers / API
// ============================================

/**
 * Failure helper for route handlers: builds the 401/403 JSON response the
 * caller should return when the check below rejects the request.
 */
export function deniedResponse(status: 401 | 403, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Guard for route handlers — returns `{ session }` or the error response. */
export async function requireApiSession(
  request: Request,
): Promise<{ session: GuardedSession } | { response: NextResponse }> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session || session.user.status !== "ACTIVE") {
    return { response: deniedResponse(401, "UNAUTHENTICATED") };
  }

  return { session };
}

/** Role guard for administrative route handlers (FR-01.06). */
export async function requireApiRole(
  request: Request,
  ...roles: UserRole[]
): Promise<{ session: GuardedSession } | { response: NextResponse }> {
  const result = await requireApiSession(request);

  if ("response" in result) return result;
  if (!roles.includes(result.session.user.role as UserRole)) {
    return { response: deniedResponse(403, "FORBIDDEN") };
  }

  return result;
}
