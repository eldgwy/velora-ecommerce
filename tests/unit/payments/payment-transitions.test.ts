import { describe, it, expect } from "vitest";

import {
  canTransitionPayment,
  isTerminalPaymentStatus,
} from "@/modules/payments/domain/payment-transitions";

describe("payment transition matrix", () => {
  it("allows the normal lifecycle", () => {
    expect(canTransitionPayment("PENDING", "COMPLETED")).toBe(true);
    expect(canTransitionPayment("PENDING", "FAILED")).toBe(true);
    expect(canTransitionPayment("AUTHORIZED", "COMPLETED")).toBe(true);
    expect(canTransitionPayment("AUTHORIZED", "FAILED")).toBe(true);
    expect(canTransitionPayment("COMPLETED", "REFUNDED")).toBe(true);
  });

  it("treats same-state repeats as replays", () => {
    expect(canTransitionPayment("PENDING", "PENDING")).toBe(true);
    expect(canTransitionPayment("COMPLETED", "COMPLETED")).toBe(true);
    expect(canTransitionPayment("FAILED", "FAILED")).toBe(true);
    expect(canTransitionPayment("REFUNDED", "REFUNDED")).toBe(true);
  });

  it("rejects downgrades and resurrections", () => {
    // Completed money must never become failed through an ordinary event.
    expect(canTransitionPayment("COMPLETED", "FAILED")).toBe(false);
    expect(canTransitionPayment("COMPLETED", "PENDING")).toBe(false);
    // Refunded money stays refunded; failed stays failed.
    expect(canTransitionPayment("REFUNDED", "COMPLETED")).toBe(false);
    expect(canTransitionPayment("REFUNDED", "FAILED")).toBe(false);
    expect(canTransitionPayment("REFUNDED", "PENDING")).toBe(false);
    expect(canTransitionPayment("FAILED", "COMPLETED")).toBe(false);
    expect(canTransitionPayment("FAILED", "PENDING")).toBe(false);
    expect(canTransitionPayment("FAILED", "REFUNDED")).toBe(false);
    // Refunds apply to captured money only.
    expect(canTransitionPayment("PENDING", "REFUNDED")).toBe(false);
    expect(canTransitionPayment("AUTHORIZED", "REFUNDED")).toBe(false);
  });

  it("marks FAILED and REFUNDED terminal", () => {
    expect(isTerminalPaymentStatus("FAILED")).toBe(true);
    expect(isTerminalPaymentStatus("REFUNDED")).toBe(true);
    expect(isTerminalPaymentStatus("PENDING")).toBe(false);
    expect(isTerminalPaymentStatus("AUTHORIZED")).toBe(false);
    // COMPLETED still has one outbound edge (authorized refund flow).
    expect(isTerminalPaymentStatus("COMPLETED")).toBe(false);
  });
});
