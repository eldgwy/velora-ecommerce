import { notFound } from "next/navigation";

import { getBrandById } from "@/services/brand.service";
import { BrandForm } from "@/modules/catalog/presentation/components/brand-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit brand — VELORA Admin",
};

export default async function EditBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Edit brand</h1>
        <p className="mt-1 text-sm text-muted-foreground">{brand.name}</p>
      </div>
      <BrandForm initial={brand} />
    </div>
  );
}
