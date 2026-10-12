import { createHmac, randomUUID, timingSafeEqual } from "crypto";

/**
 * Guest-cart cookie (FR-06.01).
 *
 * Storage strategy: SERVER-SIDE guest `cart` rows. The cookie carries only an
 * opaque guest token (`guestId`, a random UUID) plus metadata — never prices,
 * quantities, or items. Every business fact is re-read from Postgres, so the
 * HMAC here protects integrity (tamper-evidence), not trust: the token only
 * identifies a row, and row access is still validated server-side.
 *
 * Security properties:
 * - HMAC-SHA256 over base64url(JSON payload), verified with timingSafeEqual.
 * - Payload shape + version checked; malformed/tampered values return null.
 * - Hard size cap so oversized cookies are rejected before parsing.
 * - HttpOnly, Secure (production), SameSite=Lax, 30-day expiry.
 * - A guest token NEVER authorizes access to another user's cart: guest rows
 *   (userId IS NULL) and user rows are resolved through separate code paths.
 */

export const GUEST_CART_COOKIE_NAME = "velora_guest_cart";
export const COOKIE_VERSION = 1;
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Raw cookie values larger than this are rejected without parsing. */
const MAX_COOKIE_BYTES = 512;

const DEV_FALLBACK_SECRET = "dev-secret-change-in-production";

export interface GuestCartCookiePayload {
  /** Opaque token identifying the server-side guest cart row. */
  guestId: string;
  createdAt: number;
  version: number;
}

export function getGuestCartSecret(): string {
  const secret = process.env.GUEST_CART_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "GUEST_CART_SECRET environment variable is required in production",
      );
    }
    return DEV_FALLBACK_SECRET;
  }
  return secret;
}

export function newGuestId(): string {
  return randomUUID();
}

function encodePayload(payload: GuestCartCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(
  encoded: string,
): GuestCartCookiePayload | null {
  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(json) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as Record<string, unknown>).guestId !== "string" ||
      typeof (payload as Record<string, unknown>).createdAt !== "number" ||
      typeof (payload as Record<string, unknown>).version !== "number"
    ) {
      return null;
    }
    const typed = payload as GuestCartCookiePayload;
    if (typed.version !== COOKIE_VERSION) return null;
    if (typed.guestId.length === 0 || typed.guestId.length > 128) return null;
    if (!Number.isFinite(typed.createdAt)) return null;
    return typed;
  } catch {
    return null;
  }
}

export function signGuestCartCookie(
  payload: GuestCartCookiePayload,
): string {
  const secret = getGuestCartSecret();
  const encoded = encodePayload(payload);
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verify a raw cookie value. Returns the payload on success, null when the
 * cookie is missing, malformed, oversized, version-mismatched, or tampered.
 * Never throws for untrusted input.
 */
export function verifyGuestCartCookie(
  cookieValue: string | undefined | null,
): GuestCartCookiePayload | null {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  if (cookieValue.length > MAX_COOKIE_BYTES) return null;

  const separatorIndex = cookieValue.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const encoded = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  if (!encoded || !signature) return null;

  const secret = getGuestCartSecret();
  const expectedSignature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expectedSignature, "utf8");
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  return decodePayload(encoded);
}

export function createGuestCartCookie(guestId: string): string {
  return signGuestCartCookie({
    guestId,
    createdAt: Date.now(),
    version: COOKIE_VERSION,
  });
}

export const guestCartCookieOptions = {
  name: GUEST_CART_COOKIE_NAME,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

export function clearGuestCartCookie() {
  return {
    name: GUEST_CART_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
