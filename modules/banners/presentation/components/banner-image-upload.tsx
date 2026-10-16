"use client";

import { useState, useTransition } from "react";

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";

/**
 * Desktop/mobile image pickers reusing the Cloudinary signed-upload flow:
 * the server signs params scoped to the banner folder, the browser uploads
 * directly, and the returned secure URL fills the hidden form field.
 */
export function BannerImageUpload({
  bannerId,
  desktopValue,
  mobileValue,
  onDesktopChange,
  onMobileChange,
}: {
  bannerId: string | null;
  desktopValue: string;
  mobileValue: string;
  onDesktopChange: (url: string) => void;
  onMobileChange: (url: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const upload = (file: File, target: "desktop" | "mobile") => {
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) {
      setError("Only JPEG, PNG, or WebP images are accepted.");
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError("Image must be non-empty and at most 10 MB.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const { getBannerCoverUploadParamsAction } = await import(
          "@/modules/banners/presentation/actions/banner-admin.actions"
        );
        const paramsRes = await getBannerCoverUploadParamsAction({
          bannerId: bannerId ?? undefined,
        });
        if (!paramsRes.ok || !paramsRes.data) {
          setError(paramsRes.ok ? "Upload unavailable." : paramsRes.error);
          return;
        }
        const { params } = paramsRes.data;
        const form = new FormData();
        form.append("file", file);
        form.append("timestamp", String(params.timestamp));
        form.append("signature", params.signature);
        form.append("api_key", params.apiKey);
        form.append("folder", params.folder);
        if (params.uploadPreset) form.append("upload_preset", params.uploadPreset);
        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${params.cloudName}/image/upload`,
          { method: "POST", body: form },
        );
        if (!res.ok) throw new Error("upload failed");
        const body = (await res.json()) as { secure_url?: string };
        if (!body.secure_url) throw new Error("upload failed");
        if (target === "desktop") onDesktopChange(body.secure_url);
        else onMobileChange(body.secure_url);
      } catch {
        setError("Image upload failed. Please try again.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:col-span-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="banner-desktop-file">Desktop image (required)</Label>
          {desktopValue ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={desktopValue} alt="Desktop preview" className="h-32 w-full rounded-lg object-cover" />
          ) : null}
          <Input
            id="banner-desktop-file"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file, "desktop");
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="banner-mobile-file">Mobile image (optional, falls back to desktop)</Label>
          {mobileValue ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mobileValue} alt="Mobile preview" className="h-32 w-full rounded-lg object-cover" />
          ) : null}
          <Input
            id="banner-mobile-file"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file, "mobile");
            }}
          />
        </div>
      </div>
      {pending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-4" /> Uploading…
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
