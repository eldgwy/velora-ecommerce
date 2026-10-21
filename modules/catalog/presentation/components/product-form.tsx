"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import { PRODUCT_STATUS } from "@/shared/types/catalog";
import { createProduct, updateProduct } from "@/shared/lib/actions/products";

export interface ProductAdminRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  basePrice: string;
  comparePrice: string | null;
  categoryId: string;
  brandId: string;
}

function optional(form: FormData, key: string): string | undefined {
  const raw = String(form.get(key) ?? "").trim();
  return raw.length > 0 ? raw : undefined;
}

/**
 * Product core-fields form (create/edit), driving the existing product
 * actions. Status participates in the same schema; publishing is explicit.
 * Images and variants are managed on the product's detail page.
 */
export function ProductForm({
  initial,
  categories,
  brands,
}: {
  initial?: ProductAdminRow;
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (form: FormData) => {
    const comparePrice = optional(form, "comparePrice");
    const payload = {
      slug: String(form.get("slug") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      description: optional(form, "description"),
      status: String(form.get("status") ?? "DRAFT") as (typeof PRODUCT_STATUS)[number],
      basePrice: String(form.get("basePrice") ?? ""),
      comparePrice,
      categoryId: String(form.get("categoryId") ?? ""),
      brandId: String(form.get("brandId") ?? ""),
    };
    startTransition(async () => {
      if (initial) {
        const res = await updateProduct(initial.id, payload);
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
        toast.success("Product updated.");
        router.refresh();
        return;
      }
      const res = await createProduct(payload);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Product created.");
      router.push(`/admin/products/${res.id}`);
    });
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            name="name"
            defaultValue={initial?.name ?? ""}
            maxLength={200}
            placeholder="Selene Wool Coat"
            autoComplete="off"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-slug">Slug</Label>
          <Input
            id="product-slug"
            name="slug"
            defaultValue={initial?.slug ?? ""}
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers, and hyphens"
            placeholder="selene-wool-coat"
            autoComplete="off"
            required
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-base-price">Base price</Label>
          <Input
            id="product-base-price"
            name="basePrice"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={initial?.basePrice ?? ""}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-compare-price">Compare price (optional)</Label>
          <Input
            id="product-compare-price"
            name="comparePrice"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={initial?.comparePrice ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-status">Status</Label>
          <select
            id="product-status"
            name="status"
            defaultValue={initial?.status ?? "DRAFT"}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {PRODUCT_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-category">Category</Label>
          <select
            id="product-category"
            name="categoryId"
            defaultValue={initial?.categoryId ?? ""}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            required
          >
            <option value="" disabled>
              Select…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-brand">Brand</Label>
          <select
            id="product-brand"
            name="brandId"
            defaultValue={initial?.brandId ?? ""}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            required
          >
            <option value="" disabled>
              Select…
            </option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="product-description">Description (optional)</Label>
        <Textarea
          id="product-description"
          name="description"
          defaultValue={initial?.description ?? ""}
          maxLength={5000}
          rows={4}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {initial ? "Save product" : "Create product"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/admin/products")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
