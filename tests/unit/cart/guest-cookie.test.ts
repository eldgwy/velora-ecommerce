import { describe, it, expect, vi, afterEach } from "vitest";

import {
  createGuestCartCookie,
  signGuestCartCookie,
  verifyGuestCartCookie,
  newGuestId,
} from "@/modules/cart/domain/guest-cookie";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guest cart cookie", () => {
  it("round-trips a valid payload", () => {
    const guestId = newGuestId();
    const value = createGuestCartCookie(guestId);
    const payload = verifyGuestCartCookie(value);
    expect(payload).not.toBeNull();
    expect(payload?.guestId).toBe(guestId);
    expect(payload?.version).toBe(1);
  });

  it("rejects a tampered signature", () => {
    const value = createGuestCartCookie(newGuestId());
    const tampered = value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
    expect(verifyGuestCartCookie(tampered)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const value = createGuestCartCookie(newGuestId());
    const [encoded, sig] = value.split(".");
    const other = signGuestCartCookie({
      guestId: newGuestId(),
      createdAt: Date.now(),
      version: 1,
    }).split(".")[0];
    expect(verifyGuestCartCookie(`${other}.${sig}`)).toBeNull();
    void encoded;
  });

  it("rejects malformed values without throwing", () => {
    expect(verifyGuestCartCookie(null)).toBeNull();
    expect(verifyGuestCartCookie(undefined)).toBeNull();
    expect(verifyGuestCartCookie("")).toBeNull();
    expect(verifyGuestCartCookie("no-separator")).toBeNull();
    expect(verifyGuestCartCookie(".")).toBeNull();
    expect(verifyGuestCartCookie("!!!.???")).toBeNull();
  });

  it("rejects oversized cookies before parsing", () => {
    expect(verifyGuestCartCookie(`x.${"y".repeat(600)}`)).toBeNull();
  });

  it("rejects wrong-version payloads", () => {
    const value = signGuestCartCookie({
      guestId: newGuestId(),
      createdAt: Date.now(),
      version: 999,
    });
    expect(verifyGuestCartCookie(value)).toBeNull();
  });

  it("rejects cookies signed with a different secret", () => {
    vi.stubEnv("GUEST_CART_SECRET", "secret-one");
    const value = createGuestCartCookie(newGuestId());
    vi.stubEnv("GUEST_CART_SECRET", "secret-two");
    expect(verifyGuestCartCookie(value)).toBeNull();
  });

  it("generates unique guest ids", () => {
    expect(newGuestId()).not.toBe(newGuestId());
  });
});
