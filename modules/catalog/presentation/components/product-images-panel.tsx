"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  createProductImage,
  deleteProductImage,
  getSignedUploadParams,
  setPrimaryImage,
} from "@/shared/lib/actions/media";
import { validateImageFile } from "@/shared/lib/image-validation";

export interface ProductImageRow {
  id: string;
  url: string;
  publicId: string;
  alt: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

/**
 * Product images panel: browser uploads go straight to the provider with
 * server-signed params scoped to this product's folder; the resulting
 * reference is recorded through the existing image actions. Files are
 * pre-flight checked with the canonical shared validator (GP-15) before any
 * upload is attempted.
 */
export function ProductImagesPanel({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    for (const file of list) {
      const check = validateImageFile({ mimeType: file.type, size: file.size, filename: file.name });
      if (!check.valid) {
        toast.error(`"${file.name}": ${check.error}`);
        return;
      }
    }
    setUploading(true);
    try {
      const paramsRes = await getSignedUploadParams(productId);
      if ("error" in paramsRes) {
        toast.error(paramsRes.error);
        return;
      }
      const { params } = paramsRes;
      const nextSort = images.length;
      for (const [idx, file] of list.entries()) {
        const form = new FormData();
        form.append("file", file);
        form.append("timestamp", String(params.timestamp));
        form.append("signature", params.signature);
        form.append("api_key", params.apiKey);
        form.append("folder", params.folder);
        if (params.uploadPreset) form.append("upload_preset", params.uploadPreset);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${params.cloudName}/image/upload`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error("upload failed");
        const body = (await res.json()) as { secure_url?: string; public_id?: string };
        if (!body.secure_url || !body.public_id) throw new Error("upload incomplete");

        const created = await createProductImage(productId, {
          url: body.secure_url,
          publicId: body.public_id,
          sortOrder: nextSort + idx,
        });
        if ("error" in created) toast.error(created.error);
      }
      toast.success(list.length === 1 ? "Image added." : `${list.length} images added.`);
      refresh();
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const setPrimary = (imageId: string) => {
    setBusy(true);
    startTransition(async () => {
      const res = await setPrimaryImage(imageId);
      setBusy(false);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Primary image updated.");
      refresh();
    });
  };

  const remove = (imageId: string) => {
    if (!window.confirm("Delete this image? The stored asset is removed as well.")) return;
    setBusy(true);
    startTransition(async () => {
      const res = await deleteProductImage(imageId);
      setBusy(false);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Image deleted.");
      refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Images</h2>
        <label className="cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
          {uploading ? "Uploading…" : "Add images"}
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/avif"
            multiple
            className="sr-only"
            disabled={uploading || busy}
            onChange={(e) => {
              const files = e.target.files;
              e.target.value = "";
              void onFilesSelected(files);
            }}
          />
        </label>
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No images yet. The storefront renders a monogram placeholder until one is added.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img) => (
            <li
              key={img.id}
              className="flex flex-col gap-1.5 rounded-lg border border-border/50 p-2 text-xs"
            >
              {/* Server-rendered src from the recorded provider URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt ?? "Product image"}
                className="aspect-square w-full rounded object-cover"
              />
              <span className="truncate text-muted-foreground" title={img.publicId}>
                {img.isPrimary ? "★ Primary" : `#${img.sortOrder + 1}`}
              </span>
              <span className="flex gap-1.5">
                {!img.isPrimary ? (
                  <Button size="sm" variant="outline" disabled={busy || uploading} onClick={(e) => { e.preventDefault(); setPrimary(img.id); }}>
                    Set primary
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={busy || uploading} onClick={(e) => { e.preventDefault(); remove(img.id); }}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {uploading ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Uploading to the image provider…
        </span>
      ) : null}
    </section>
  );
}
