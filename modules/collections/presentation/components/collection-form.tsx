"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  createCollectionAction,
  updateCollectionAction,
} from "@/modules/collections/presentation/actions/collection-admin.actions";
import { CoverImageUpload } from "@/modules/collections/presentation/components/cover-image-upload";
import type { CollectionDetail } from "@/modules/collections/application/queries/collections";

/**
 * Collection create/edit form. Slug derives from the name unless the admin
 * types an explicit one; validation and authorization live server-side.
 */
export function CollectionForm({ initial }: { initial?: CollectionDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [image, setImage] = useState(initial?.image ?? "");

  const onSubmit = (form: FormData) => {
    const payload = {
      ...(initial ? { id: initial.id } : {}),
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      description: String(form.get("description") ?? ""),
      image,
      isActive: form.get("isActive") === "on",
      sortOrder: String(form.get("sortOrder") ?? ""),
    };
    startTransition(async () => {
      const res = initial
        ? await updateCollectionAction(payload)
        : await createCollectionAction(payload);
      if (res.ok) {
        toast.success(initial ? "Collection updated." : "Collection created.");
        router.push(initial ? `/admin/collections/${initial.id}` : "/admin/collections");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={initial?.name ?? ""} placeholder="Summer Essentials" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="slug">Slug (optional, blank = from name)</Label>
          <Input id="slug" name="slug" defaultValue={initial?.slug ?? ""} placeholder="summer-essentials" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea id="description" name="description" defaultValue={initial?.description ?? ""} rows={3} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sortOrder">Sort order (optional)</Label>
          <Input
            id="sortOrder"
            name="sortOrder"
            defaultValue={initial?.sortOrder?.toString() ?? ""}
            placeholder="0"
            inputMode="numeric"
          />
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial?.isActive ?? false}
            className="size-4"
          />
          Published
        </label>
        <div className="sm:col-span-2">
          <CoverImageUpload collectionId={initial?.id ?? null} value={image} onChange={setImage} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} type="submit">
          {pending ? <Spinner className="size-4" /> : null}
          {initial ? "Save changes" : "Create collection"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => router.back()}>
          Back
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        New collections start unpublished. Publishing makes them visible at /collections.
      </p>
    </form>
  );
}
