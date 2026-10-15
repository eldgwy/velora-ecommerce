import { PromotionForm } from "@/modules/promotions/presentation/components/promotion-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New promotion — VELORA Admin",
};

export default function NewPromotionPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New promotion</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Percentage (0–100] or fixed amount. Products are mapped on the detail page.
        </p>
      </div>
      <PromotionForm />
    </div>
  );
}
