import { getRecentHistory } from "@/modules/recently-viewed/application/queries/history";
import { HistoryRowList } from "@/modules/recently-viewed/presentation/components/history-rows";

/**
 * Authenticated history section for the product detail page: recent
 * products excluding the one on display. Empty histories render nothing.
 */
export async function RecentViewsSection({
  userId,
  currentProductId,
}: {
  userId: string;
  currentProductId: string;
}) {
  const history = await getRecentHistory(userId, {
    excludeProductId: currentProductId,
    limit: 8,
  });
  return <HistoryRowList items={history.items} heading="Recently viewed" />;
}
