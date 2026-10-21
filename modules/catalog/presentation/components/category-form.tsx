"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import { createCategory, updateCategory } from "@/shared/lib/actions/catalog";

export interface CategoryAdminRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  parentId: string | null;
  isActive: boolean | null;
}

function optional(form: FormData, key: string): string | undefined {
  const raw = String(form.get(key) ?? "").trim();
  return raw.length > 0 ? raw : undefined;
}

/**
 * Category create/edit form. The parent select is filtered server-side
 * before rendering (self/cycle options excluded by the caller); the action
 * re-validates existence and cycles. There is no category delete action —
 * visibility is managed through isActive instead.
 */
export function CategoryForm({
  initial,
  parentOptions,
}: {
  initial?: CategoryAdminRow;
  /** Candidate parents: explicit or-derived rows (id/name only). */
  parentOptions: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (form: FormData) => {
    const parentValue = String(form.get("parentId") ?? "");
    const payload = {
      slug: String(form.get("slug") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      description: optional(form, "description"),
      logo: optional(form, "logo"),
      parentId: parentValue.length > 0 ? parentValue : null,
      isActive: form.get("isActive") === "on",
    };
    startTransition(async () => {
      const res = initial
        ? await updateCategory(initial.id, payload)
        : await createCategory(payload);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(initial ? "Category updated." : "Category created.");
      router.push("/admin/categories");
      router.refresh();
    });
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            name="name"
            defaultValue={initial?.name ?? ""}
            maxLength={120}
            placeholder="Outerwear"
            autoComplete="off"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="category-slug">Slug</Label>
          <Input
            id="category-slug"
            name="slug"
            defaultValue={initial?.slug ?? ""}
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers, and hyphens"
            placeholder="outerwear"
            autoComplete="off"
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="category-parent">Parent category</Label>
        <select
          id="category-parent"
          name="parentId"
          defaultValue={initial?.parentId ?? ""}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">None (top level)</option>
          {parentOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="category-description">Description (optional)</Label>
        <Textarea
          id="category-description"
          name="description"
          defaultValue={initial?.description ?? ""}
          maxLength={500}
          rows={3}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="category-logo">Logo URL (optional)</Label>
        <Input
          id="category-logo"
          name="logo"
          type="url"
          defaultValue={initial?.logo ?? ""}
          maxLength={500}
          placeholder="https://res.cloudinary.com/…"
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="category-active"
          name="isActive"
          type="checkbox"
          defaultChecked={initial?.isActive ?? true}
          className="size-4"
        />
        <Label htmlFor="category-active">Visible in storefront navigation</Label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {initial ? "Save category" : "Create category"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/admin/categories")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
