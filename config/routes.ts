/**
 * Canonical route definitions (FR-01).
 *
 * Centralised here so the proxy, guards, and every client-side redirect agree
 * on a single source of truth. Pages live in `app/` under the `(auth)` and
 * `(storefront)` route-groups — the group name is stripped from the URL, so
 * every constant below is the public-facing path a user sees.
 *
 * Auth pages:  /login, /register, /forgot-password, /reset-password, /verify-email
 * Account pages: /account/profile, /account/settings
 */

export const AUTH_ROUTES = {
  LOGIN: "/login",
  REGISTER: "/register",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  VERIFY_EMAIL: "/verify-email",
} as const;

export const ACCOUNT_ROUTES = {
  PROFILE: "/account/profile",
  SETTINGS: "/account/settings",
} as const;

export const ADMIN_ROUTES = {
  DASHBOARD: "/admin",
  PRODUCTS: "/admin/products",
  CUSTOMERS: "/admin/customers",
  ORDERS: "/admin/orders",
} as const;

/** Every page a guest must never see while signed in. */
export const PUBLIC_ONLY_ROUTES: readonly string[] = [
  AUTH_ROUTES.LOGIN,
  AUTH_ROUTES.REGISTER,
];

/** Prefixes that require a valid, active session. */
export const AUTH_REQUIRED_PREFIXES: readonly string[] = ["/account", "/orders", "/checkout"];
export const AUTH_REQUIRED_ROUTES: readonly string[] = [
  ACCOUNT_ROUTES.PROFILE,
  ACCOUNT_ROUTES.SETTINGS,
];

/** Staff surface (SRS FR-01.06): ADMIN or STAFF roles only. */
export const ADMIN_ROUTES_ARRAY: readonly string[] = ["/admin"];
