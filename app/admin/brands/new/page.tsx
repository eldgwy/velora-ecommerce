import { BrandForm } from "@/modules/catalog/presentation/components/brand-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New brand — VELORA Admin",
};

export default function NewBrandPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New brand</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The slug is the public URL segment; keep it lowercase with hyphens.
        </p>
      </div>
      <BrandForm />
    </div>
  );
}
