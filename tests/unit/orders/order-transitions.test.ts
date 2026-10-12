import { describe, it, expect } from "vitest";

import {
  canTransitionOrder,
  findTransition,
  isTerminalOrderStatus,
  ORDER_TRANSITIONS,
} from "@/modules/orders/domain/rules/order-transitions";

describe("order transition matrix", () => {
  it("covers every enum state without parallel machines", () => {
    const states = new Set(ORDER_TRANSITIONS.flatMap((t) => [t.from, t.to]));
    for (const s of ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]) {
      expect(states.has(s as never)).toBe(true);
    }
  });

  it("lets verified payment move PENDING → PROCESSING, nobody else", () => {
    expect(canTransitionOrder("PENDING", "PROCESSING", "webhook")).toBe(true);
    expect(canTransitionOrder("PENDING", "PROCESSING", "customer")).toBe(false);
    expect(canTransitionOrder("PENDING", "PROCESSING", "staff")).toBe(false);
    expect(canTransitionOrder("PENDING", "PROCESSING", "admin")).toBe(false);
  });

  it("lets customers cancel PENDING but nothing further", () => {
    expect(canTransitionOrder("PENDING", "CANCELLED", "customer")).toBe(true);
    expect(canTransitionOrder("PROCESSING", "CANCELLED", "customer")).toBe(false);
    expect(canTransitionOrder("SHIPPED", "CANCELLED", "customer")).toBe(false);
  });

  it("lets staff advance fulfillment but never skip stages", () => {
    expect(canTransitionOrder("PROCESSING", "SHIPPED", "staff")).toBe(true);
    expect(canTransitionOrder("SHIPPED", "DELIVERED", "admin")).toBe(true);
    expect(canTransitionOrder("PENDING", "SHIPPED", "staff")).toBe(false);
    expect(canTransitionOrder("PROCESSING", "DELIVERED", "staff")).toBe(false);
    expect(canTransitionOrder("SHIPPED", "PROCESSING", "admin")).toBe(false);
  });

  it("treats terminal states as sinks", () => {
    expect(isTerminalOrderStatus("DELIVERED")).toBe(true);
    expect(isTerminalOrderStatus("CANCELLED")).toBe(true);
    expect(isTerminalOrderStatus("PENDING")).toBe(false);
    expect(findTransition("DELIVERED", "PROCESSING")).toBeNull();
    expect(findTransition("CANCELLED", "PENDING")).toBeNull();
  });

  it("treats same-state repeats as replays", () => {
    expect(canTransitionOrder("PENDING", "PENDING", "customer")).toBe(true);
    expect(canTransitionOrder("CANCELLED", "CANCELLED", "webhook")).toBe(true);
  });
});
