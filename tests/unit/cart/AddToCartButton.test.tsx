import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AddToCartButton } from "@/shared/components/product/AddToCartButton";
import { addToCart } from "@/modules/cart/presentation/actions/cart.actions";

vi.mock("@/modules/cart/presentation/actions/cart.actions", () => ({
  addToCart: vi.fn(),
}));

// The global lucide-react mock has no Loader2/Check exports; provide locals.
vi.mock("lucide-react", () => ({
  Loader2: ({ className }: { className?: string }) => (
    <svg data-testid="loader-icon" className={className} aria-hidden="true" />
  ),
  Check: ({ className }: { className?: string }) => (
    <svg data-testid="check-icon" className={className} aria-hidden="true" />
  ),
}));

const mockedAddToCart = vi.mocked(addToCart);

describe("AddToCartButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls addToCart with the variant identity and quantity 1", async () => {
    mockedAddToCart.mockResolvedValue({ ok: true, data: { cartId: "c1" } });
    render(<AddToCartButton variantId="11111111-1111-1111-1111-111111111111" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockedAddToCart).toHaveBeenCalledTimes(1);
    });
    expect(mockedAddToCart).toHaveBeenCalledWith({
      variantId: "11111111-1111-1111-1111-111111111111",
      quantity: 1,
    });
  });

  it("shows the success state after a confirmed add", async () => {
    mockedAddToCart.mockResolvedValue({ ok: true, data: { cartId: "c1" } });
    render(<AddToCartButton variantId="11111111-1111-1111-1111-111111111111" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toContain("Added");
    });
  });

  it("surfaces the server error and stays enabled for retry", async () => {
    mockedAddToCart.mockResolvedValue({ ok: false, error: "Insufficient stock." });
    render(<AddToCartButton variantId="11111111-1111-1111-1111-111111111111" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockedAddToCart).toHaveBeenCalledTimes(1);
    });
    // The transition end (pending -> false + label reset) lands a microtask
    // after the action resolves; await it instead of racing the flush.
    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toContain("Add to Cart");
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("renders disabled without a resolved variant", () => {
    render(<AddToCartButton variantId={null} />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("renders disabled with the parent-provided disabled label", () => {
    render(
      <AddToCartButton
        variantId={null}
        disabled
        disabledLabel="Out of Stock"
      />,
    );
    expect(screen.getByRole("button").textContent).toBe("Out of Stock");
  });

  it("ignores rapid repeated clicks while pending", async () => {
    let resolveAdd!: (v: { ok: true; data: { cartId: string } }) => void;
    mockedAddToCart.mockReturnValue(
      new Promise((resolve) => {
        resolveAdd = resolve;
      }),
    );
    render(<AddToCartButton variantId="11111111-1111-1111-1111-111111111111" />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    resolveAdd({ ok: true, data: { cartId: "c1" } });
    await waitFor(() => {
      expect(mockedAddToCart).toHaveBeenCalledTimes(1);
    });
  });
});
