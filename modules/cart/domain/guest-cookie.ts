import { createHmac, timingSafeEqual } from "crypto";

const GUEST_CART_COOKIE_NAME = "velora_guest_cart";
const COOKIE_VERSION = 1;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SECRET = process.env.GUEST_CART_SECRET ?? "dev-secret-change-in-production";

export function getGuestCartSecret(): string {
  const secret = process.env.GUEST_CART_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("GUEST_CART_SECRET environment variable is required in production");
    }
    return "dev-secret-change-in-production";
  }
  return secret;
}

export function signCartCookie(payload: { cartId: string; createdAt: number; version: number }): string {
  const secret = getGuestCartSecret();
  const data = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(data).digest("hex");
  return `${data}.${signature}`;
}

export function verifyCartCookie(cookieValue: string): { cartId: string; createdAt: number; version: number } | null {
  if (!cookieValue || !cookieValue.includes(".")) {
    return null;
  }

  const secret = getGuestCartSecret();
  const [data, signature] = cookieValue.split(".");
  
  if (!data || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret).update(data).digest("hex");
  
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(data);
    if (
      typeof payload.cartId !== "string" ||
      typeof payload.createdAt !== "number" ||
      typeof payload.version !== "number" ||
      payload.version !== COOKIE_VERSION
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createGuestCartCookie(cartId: string): string {
  const payload = {
    cartId,
    createdAt: Date.now(),
    version: COOKIE_VERSION,
  };
  return signCartCookie(payload);
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