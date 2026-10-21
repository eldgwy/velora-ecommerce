"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  createBrand,
  updateBrand,
} from "@/shared/lib/actions/brands";

export interface BrandAdminRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  website: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

function optional(form: FormData, key: string): string | undefined {
  const raw = String(form.get(key) ?? "").trim();
  return raw.length > 0 ? raw : undefined;
}

/**
 * Brand create/edit form driven by the existing brand actions; validation is
 * re-enforced server-side (slug shape, lengths) — the client only avoids
 * obvious mistakes and renders action errors verbatim.
 */
export function BrandForm({ initial }: { initial?: BrandAdminRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (form: FormData) => {
    const payload = {
      slug: String(form.get("slug") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      description: optional(form, "description"),
      logo: optional(form, "logo"),
      website: optional(form, "website"),
      seoTitle: optional(form, "seoTitle"),
      seoDescription: optional(form, "seoDescription"),
    };
    startTransition(async () => {
      const res = initial
        ? await updateBrand(initial.id, payload)
        : await createBrand(payload);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(initial ? "Brand updated." : "Brand created.");
      router.push("/admin/brands");
      router.refresh();
    });
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="brand-name">Name</Label>
          <Input
            id="brand-name"
            name="name"
            defaultValue={initial?.name ?? ""}
            maxLength={120}
            placeholder="Atelier Noir"
            autoComplete="off"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="brand-slug">Slug</Label>
          <Input
            id="brand-slug"
            name="slug"
            defaultValue={initial?.slug ?? ""}
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers, and hyphens"
            placeholder="atelier-noir"
            autoComplete="off"
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="brand-description">Description (optional)</Label>
        <Textarea
          id="brand-description"
          name="description"
          defaultValue={initial?.description ?? ""}
          maxLength={500}
          rows={3}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="brand-logo">Logo URL (optional)</Label>
          <Input
            id="brand-logo"
            name="logo"
            type="url"
            defaultValue={initial?.logo ?? ""}
            maxLength={500}
            placeholder="https://res.cloudinary.com/…"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="brand-website">Website (optional)</Label>
          <Input
            id="brand-website"
            name="website"
            type="url"
            defaultValue={initial?.website ?? ""}
            maxLength={255}
            placeholder="https://…"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="brand-seo-title">SEO title (optional)</Label>
          <Input
            id="brand-seo-title"
            name="seoTitle"
            defaultValue={initial?.seoTitle ?? ""}
            maxLength={160}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="brand-seo-description">SEO description (optional)</Label>
          <Textarea
            id="brand-seo-description"
            name="seoDescription"
            defaultValue={initial?.seoDescription ?? ""}
            maxLength={320}
            rows={2}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {initial ? "Save brand" : "Create brand"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/brands")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
