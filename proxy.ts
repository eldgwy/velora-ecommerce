// ============================================
// Proxy (Next 16 file convention, replaces middleware)
// FR-01.06 — route-level authentication & role interceptor.
// ============================================

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/shared/lib/auth";
import { ADMIN_ROLES, type UserRole } from "@/shared/lib/roles";

// ============================================
// Route policy
// ============================================

/** Signs users in here — never gate these behind a session. */
const AUTH_PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

/**
 * Signed-in-only destinations. Guarded proactively so guards keep working
 * the moment the pages land (Navbar already links /profile and /settings).
 */
const AUTH_REQUIRED_PREFIXES = [
  "/account",
  "/orders",
  "/checkout",
];

/** Staff surface (SRS FR-01.06): ADMIN or STAFF roles only. */
const ADMIN_PREFIXES = ["/admin"];

/** Bounce logged-in users away from these — nothing to do there anymore. */
const AUTH_REDIRECT_AWAY = ["/login", "/register"];

// ============================================
// 403 body
// ============================================

/**
 * Self-contained forbidden page. Proxy can't render React, so this inline
 * document matches the Velora palette and links back to safety. Emitted
 * with a real HTTP 403 status (SRS FR-01.06).
 */
function forbiddenPage(returnPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f2ee;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c211f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:64px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e6e2da;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="background-color:#365f54;padding:28px 32px;">
                <p style="margin:0;font-size:20px;font-weight:600;letter-spacing:0.24em;color:#ffffff;">VELORA</p>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px;text-align:center;">
                <p style="margin:0 0 8px;font-size:44px;font-weight:700;color:#365f54;">403</p>
                <p style="margin:0 0 12px;font-size:18px;font-weight:600;">Access denied</p>
                <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#4a524e;">
                  Your account doesn't have permission to open
                  <strong style="color:#1c211f;">${returnPath}</strong>.
                </p>
                <a href="/" style="display:inline-block;padding:12px 30px;font-size:14px;font-weight:600;color:#ffffff;background-color:#365f54;border-radius:999px;text-decoration:none;">Back to the store</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ============================================
// Proxy
// ============================================

/**
 * Route-level auth interceptor (replaces the deprecated middleware.ts).
 * Runs on the Node.js runtime in Next 16, so better-auth + Postgres work
 * directly. Only matched prefixes reach this function (see `config`).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isAdminRoute = ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const needsAuth =
    isAdminRoute ||
    AUTH_REQUIRED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

  const isAuthPage = AUTH_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );

  // Leave public pages alone — the login form already reads `callbackUrl`.
  if (!isAuthPage && !needsAuth) return NextResponse.next();

  // Read the session (cheap: `session.updateAge` means the DB write only
  // happens once the session enters its 48-hour renewal window).
  const { headers: sessionHeaders, response: session } =
    await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });

  if (!session) {
    // Auth pages must stay reachable for guests (register, reset, verify…).
    if (isAuthPage) return NextResponse.next();

    // Guests get bounced to login with a way back.
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?callbackUrl=${encodeURIComponent(`${pathname}${search}`)}`;

    return NextResponse.redirect(loginUrl);
  }

  // Authenticated visitors have nothing left to do on login/register.
  if (AUTH_REDIRECT_AWAY.includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Staff surface: block deactivated accounts and non-staff roles (FR-01.06).
  if (isAdminRoute) {
    const role = (session.user as { role?: UserRole | null }).role ?? null;

    if (session.user.status !== "ACTIVE" || !role || !ADMIN_ROLES.includes(role)) {
      return new NextResponse(forbiddenPage(pathname), {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Propagate any refreshed session cookies, then continue.
  const response = NextResponse.next();

  for (const [key, value] of sessionHeaders.entries()) {
    if (key.toLowerCase() === "set-cookie") {
      response.headers.append("set-cookie", value);
    }
  }

  return response;
}

// Only guarded prefixes and the login/register pages reach `proxy` —
// everything public stays untouched.
export const config = {
  matcher: [
    "/admin/:path*",
    "/account/:path*",
    "/orders/:path*",
    "/checkout/:path*",
    "/login",
    "/register",
  ],
};