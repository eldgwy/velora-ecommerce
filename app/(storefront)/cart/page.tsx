import { getCartAction, validateCartAction } from "@/modules/cart/presentation/actions/cart.actions";
import { CartView } from "@/modules/cart/presentation/components/cart-view";

// Cart state is per-owner and dynamic: never cache, always server-render.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your Bag — VELORA",
  description: "Review your selected pieces before checkout.",
};

export default async function CartPage() {
  const [cartRes, validationRes] = await Promise.all([
    getCartAction(),
    validateCartAction(),
  ]);

  const detail = cartRes.ok && cartRes.data
    ? cartRes.data.detail
    : { cartId: null, items: [], subtotal: "0.00", discountTotal: "0.00", itemCount: 0 };
  const validation = validationRes.ok && validationRes.data
    ? validationRes.data
    : {
        valid: detail.items.length > 0,
        items: [],
        subtotal: detail.subtotal,
        discountTotal: detail.discountTotal,
        payableTotal: detail.subtotal,
        warnings: [],
        errors: [],
      };
  const merge = cartRes.ok && cartRes.data ? cartRes.data.merge : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <CartView initialDetail={detail} initialValidation={validation} initialMerge={merge} />
    </main>
  );
}
