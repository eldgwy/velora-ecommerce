import { getCurrentSession } from "@/shared/lib/guards";
import { getSavedProductIds } from "@/modules/wishlist/application/queries/wishlist";
import { getProductPromotionSummaries } from "@/modules/promotions/application/queries/promotion-pricing";
import { getHomeSections } from "@/services/home-sections";
import { buildDisplayCurrencyProps } from "@/shared/lib/currency-display-server";

import { HeroBanners } from "@/shared/components/home/HeroBanners";
import Products from "@/shared/components/home/Products";
import FeaturedCategories from "@/shared/components/home/FeaturedCategories";
import NewArrivals from "@/shared/components/home/NewArrivals";
import OurStory from "@/shared/components/home/OurStory";
import Promotion from "@/shared/components/home/Promotion";
import BestSellers from "@/shared/components/home/BestSellers";
import Newsletter from "@/shared/components/home/NewSletter";

/**
 * Storefront home (GP-02): a Server Component now — the merchandising
 * sections receive real catalog data resolved in one batched server pass
 * (cards + wishlist state + promotion views), exactly the pattern the
 * collection page uses. Static marketing sections (OurStory, Promotion,
 * Newsletter) are content, not catalog data, and stay as-is.
 */
export default async function Home() {
  const sections = await getHomeSections();
  const display = await buildDisplayCurrencyProps();

  const sectionIds = [
    ...new Set(
      [...sections.featured, ...sections.newArrivals, ...sections.bestSellers].map(
        (card) => card.id,
      ),
    ),
  ];

  const session = await getCurrentSession();
  // Batched once for every card on the page — never per section or per card.
  const [savedIds, promoSummaries] = await Promise.all([
    session
      ? getSavedProductIds(session.user.id, sectionIds)
      : Promise.resolve(new Set<string>()),
    getProductPromotionSummaries(sectionIds),
  ]);

  // Serializable shapes for the client sections.
  const savedIdsList = [...savedIds];
  const promotions = Object.fromEntries(promoSummaries);

  return (
    <main>
      <HeroBanners />
      <FeaturedCategories categories={sections.categories} />
      <Products
        products={sections.featured}
        savedIds={savedIdsList}
        promotions={promotions}
        display={display}
      />
      <NewArrivals
        products={sections.newArrivals}
        savedIds={savedIdsList}
        promotions={promotions}
        display={display}
      />
      <OurStory />
      <Promotion />
      <BestSellers
        products={sections.bestSellers}
        savedIds={savedIdsList}
        promotions={promotions}
        display={display}
      />
      <Newsletter />
    </main>
  );
}
