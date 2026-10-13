import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { WishlistToggle } from "@/modules/wishlist/presentation/components/WishlistToggle";
import { toggleWishlistAction } from "@/modules/wishlist/presentation/actions/wishlist.actions";

vi.mock("@/modules/wishlist/presentation/actions/wishlist.actions", () => ({
  toggleWishlistAction: vi.fn(),
}));

// The global lucide-react mock has no Heart export; provide a local one.
vi.mock("lucide-react", () => ({
  Heart: ({ className }: { className?: string }) => (
    <svg data-testid="heart-icon" className={className} aria-hidden="true" />
  ),
}));

const mockedToggle = vi.mocked(toggleWishlistAction);

describe("WishlistToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the unsaved state with an add label", () => {
    render(<WishlistToggle productId="p1" productName="Silk Scarf" initialSaved={false} />);
    const button = screen.getByRole("button", { name: "Add Silk Scarf to wishlist" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the saved state with a remove label", () => {
    render(<WishlistToggle productId="p1" productName="Silk Scarf" initialSaved />);
    const button = screen.getByRole("button", { name: "Remove Silk Scarf from wishlist" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles state on click and refreshes server data", async () => {
    mockedToggle.mockResolvedValue({ ok: true, data: { saved: true } });
    render(<WishlistToggle productId="p1" productName="Silk Scarf" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    });
    expect(mockedToggle).toHaveBeenCalledTimes(1);
    expect(mockedToggle).toHaveBeenCalledWith({ productId: "p1" });
  });

  it("keeps prior state when the action fails", async () => {
    mockedToggle.mockResolvedValue({ ok: false, error: "Nope." });
    render(<WishlistToggle productId="p1" productName="Silk Scarf" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockedToggle).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });

  it("ignores rapid repeated clicks while pending", async () => {
    let resolveToggle!: (v: { ok: true; data: { saved: boolean } }) => void;
    mockedToggle.mockReturnValue(
      new Promise((resolve) => {
        resolveToggle = resolve;
      }),
    );
    render(<WishlistToggle productId="p1" productName="Silk Scarf" />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockedToggle).toHaveBeenCalledTimes(1);
    resolveToggle({ ok: true, data: { saved: true } });
    await waitFor(() => {
      expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    });
  });
});
