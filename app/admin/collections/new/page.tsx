import { CollectionForm } from "@/modules/collections/presentation/components/collection-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New collection — VELORA Admin",
};

export default function NewCollectionPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New collection</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Slugs derive from the name unless overridden. Products are mapped on the detail page.
        </p>
      </div>
      <CollectionForm />
    </div>
  );
}
