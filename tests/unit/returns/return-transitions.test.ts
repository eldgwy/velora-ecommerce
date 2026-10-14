import { describe, it, expect } from "vitest";

import {
  canTransitionReturnItem,
  isRestockEligible,
  isTerminalReturnItemStatus,
} from "@/modules/returns/domain/return-transitions";

describe("return item transition matrix", () => {
  it("allows the physical-goods lifecycle", () => {
    expect(canTransitionReturnItem("PENDING", "RECEIVED")).toBe(true);
    expect(canTransitionReturnItem("PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionReturnItem("RECEIVED", "APPROVED")).toBe(true);
    expect(canTransitionReturnItem("RECEIVED", "REJECTED")).toBe(true);
    expect(canTransitionReturnItem("APPROVED", "RESTOCKED")).toBe(true);
  });

  it("treats same-state repeats as replays", () => {
    for (const s of ["PENDING", "RECEIVED", "APPROVED", "REJECTED", "RESTOCKED", "CANCELLED"] as const) {
      expect(canTransitionReturnItem(s, s)).toBe(true);
    }
  });

  it("rejects skips and resurrections", () => {
    // Nothing skips receipt or inspection.
    expect(canTransitionReturnItem("PENDING", "APPROVED")).toBe(false);
    expect(canTransitionReturnItem("PENDING", "RESTOCKED")).toBe(false);
    expect(canTransitionReturnItem("RECEIVED", "RESTOCKED")).toBe(false);
    // Terminals never move again.
    expect(canTransitionReturnItem("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionReturnItem("RESTOCKED", "APPROVED")).toBe(false);
    expect(canTransitionReturnItem("CANCELLED", "RECEIVED")).toBe(false);
    // Cancellation is only for lines that never moved past PENDING.
    expect(canTransitionReturnItem("RECEIVED", "CANCELLED")).toBe(false);
    expect(canTransitionReturnItem("APPROVED", "CANCELLED")).toBe(false);
  });

  it("marks REJECTED, RESTOCKED, CANCELLED terminal", () => {
    expect(isTerminalReturnItemStatus("REJECTED")).toBe(true);
    expect(isTerminalReturnItemStatus("RESTOCKED")).toBe(true);
    expect(isTerminalReturnItemStatus("CANCELLED")).toBe(true);
    expect(isTerminalReturnItemStatus("PENDING")).toBe(false);
    expect(isTerminalReturnItemStatus("RECEIVED")).toBe(false);
    expect(isTerminalReturnItemStatus("APPROVED")).toBe(false);
  });
});

describe("restock eligibility", () => {
  it("requires both approval and a restockable inspection", () => {
    expect(isRestockEligible("APPROVED", "RESTOCKABLE")).toBe(true);
    expect(isRestockEligible("APPROVED", "DAMAGED")).toBe(false);
    expect(isRestockEligible("APPROVED", null)).toBe(false);
    expect(isRestockEligible("RECEIVED", "RESTOCKABLE")).toBe(false);
    expect(isRestockEligible("PENDING", null)).toBe(false);
    expect(isRestockEligible("REJECTED", "DAMAGED")).toBe(false);
    expect(isRestockEligible("RESTOCKED", "RESTOCKABLE")).toBe(false);
  });
});
