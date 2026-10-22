import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import VariantSelector from "@/shared/components/product/VariantSelector";
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

type OptionValue = {
  optionId: string;
  optionName: string;
  valueId: string;
  value: string;
};

type TestVariant = {
  id: string;
  sku: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVE";
  priceOverride: string | null;
  optionValues: OptionValue[];
  availableStock: number;
};

type TestOption = {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
};

const SIZE_OPT = "0aaaaaaaa-0000-0000-0000-000000000000";
const COLOR_OPT = "0bbbbbbb-0000-0000-0000-000000000000";

function makeProduct(): {
  id: string;
  name: string;
  basePrice: string;
  comparePrice: string | null;
  options: TestOption[];
  variants: TestVariant[];
} {
  return {
    id: "prod-1",
    name: "Silk Scarf",
    basePrice: "89.90",
    comparePrice: null,
    options: [
      {
        id: SIZE_OPT,
        name: "Size",
        values: [
          { id: "small", value: "Small" },
          { id: "large", value: "Large" },
        ],
      },
      {
        id: COLOR_OPT,
        name: "Color",
        values: [{ id: "red", value: "Red" }],
      },
    ],
    variants: [
      {
        id: "v-small-red",
        sku: "SML-RED",
        status: "ACTIVE",
        priceOverride: null,
        optionValues: [
          { optionId: SIZE_OPT, optionName: "Size", valueId: "small", value: "Small" },
          { optionId: COLOR_OPT, optionName: "Color", valueId: "red", value: "Red" },
        ],
        availableStock: 5,
      },
      {
        id: "v-large-red",
        sku: "LRG-RED",
        status: "ACTIVE",
        priceOverride: "99.90",
        optionValues: [
          { optionId: SIZE_OPT, optionName: "Size", valueId: "large", value: "Large" },
          { optionId: COLOR_OPT, optionName: "Color", valueId: "red", value: "Red" },
        ],
        availableStock: 0,
      },
    ],
  };
}

/** Selects (Size, Color) values by clicking their radio buttons. */
function select(optionLabel: string, valueId: string) {
  const group = screen.getByRole("radiogroup", { name: optionLabel });
  const valueButton = Array.from(group.querySelectorAll("button")).find(
    (b) => b.textContent === ({ small: "Small", large: "Large", red: "Red" } as Record<string, string>)[valueId],
  );
  if (!valueButton) throw new Error(`option value ${valueId} not rendered`);
  fireEvent.click(valueButton);
}

describe("VariantSelector add-to-cart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps every purchase button disabled until a complete selection resolves", () => {
    render(<VariantSelector product={makeProduct()} />);
    // The purchase row renders Add to Cart plus Buy Now; both share the
    // incomplete-selection state.
    const buttons = screen.getAllByRole("button", { name: "Select Options" });
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("enables Add to Cart for a complete in-stock selection and submits the resolved variant", async () => {
    mockedAddToCart.mockResolvedValue({ ok: true, data: { cartId: "c1" } });
    render(<VariantSelector product={makeProduct()} />);
    select("Size", "small");
    select("Color", "red");
    const button = screen.getByRole("button", { name: "Add to Cart" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // Buy Now is enabled under the same stock/selection conditions.
    expect((screen.getByRole("button", { name: "Buy Now" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockedAddToCart).toHaveBeenCalledTimes(1);
    });
    expect(mockedAddToCart).toHaveBeenCalledWith({ variantId: "v-small-red", quantity: 1 });
  });

  it("disables both purchase buttons when the resolved variant has no stock", () => {
    render(<VariantSelector product={makeProduct()} />);
    select("Size", "large");
    select("Color", "red");
    const buttons = screen.getAllByRole("button", { name: "Out of Stock" });
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("still surfaces stock state for complete selections that cannot be purchased", () => {
    render(<VariantSelector product={makeProduct()} />);
    select("Size", "large");
    select("Color", "red");
    // Status line plus the disabled purchase button both show stock state.
    expect(screen.getAllByText("Out of Stock").length).toBeGreaterThanOrEqual(2);
  });

  it("disables unavailable option values so they cannot form a purchaseable selection", () => {
    const product = makeProduct();
    // Archive the large variant entirely: Large must not be selectable.
    product.variants[1] = { ...product.variants[1], status: "ARCHIVE" as const };
    render(<VariantSelector product={product} />);
    const group = screen.getByRole("radiogroup", { name: "Size" });
    const largeButton = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "Large",
    );
    expect(largeButton?.disabled).toBe(true);
  });

  it("adds the first ACTIVE variant directly for option-less products", async () => {
    mockedAddToCart.mockResolvedValue({ ok: true, data: { cartId: "c1" } });
    const product = {
      id: "prod-2",
      name: "Silk Scarf Plain",
      basePrice: "45.00",
      comparePrice: null,
      options: [],
      variants: [
        { id: "v-draft", sku: null, status: "DRAFT" as const, priceOverride: null, optionValues: [], availableStock: 9 },
        { id: "v-default", sku: "PLN", status: "ACTIVE" as const, priceOverride: null, optionValues: [], availableStock: 3 },
      ],
    };
    render(<VariantSelector product={product} />);
    const button = screen.getByRole("button", { name: "Add to Cart" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockedAddToCart).toHaveBeenCalledWith({ variantId: "v-default", quantity: 1 });
    });
  });

  it("renders Out of Stock for an option-less product with no ACTIVE variant stock", () => {
    const product = {
      id: "prod-3",
      name: "Sold Out Plain",
      basePrice: "45.00",
      comparePrice: null,
      options: [],
      variants: [
        { id: "v-active-zero", sku: null, status: "ACTIVE" as const, priceOverride: null, optionValues: [], availableStock: 0 },
      ],
    };
    render(<VariantSelector product={product} />);
    // Both purchase buttons carry the out-of-stock state.
    const buttons = screen.getAllByRole("button", { name: "Out of Stock" });
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("renders Unavailable when an option-less product has no purchasable variant", () => {
    const product = {
      id: "prod-4",
      name: "Archived Plain",
      basePrice: "45.00",
      comparePrice: null,
      options: [],
      variants: [
        { id: "v-archived", sku: null, status: "ARCHIVE" as const, priceOverride: null, optionValues: [], availableStock: 9 },
      ],
    };
    render(<VariantSelector product={product} />);
    const buttons = screen.getAllByRole("button", { name: "Unavailable" });
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    // Without a purchasable variant nothing may submit to the cart.
    fireEvent.click(buttons[0]);
    expect(mockedAddToCart).not.toHaveBeenCalled();
  });
});
