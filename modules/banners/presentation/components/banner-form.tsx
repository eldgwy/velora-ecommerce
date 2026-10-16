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
  createBannerAction,
  updateBannerAction,
} from "@/modules/banners/presentation/actions/banner-admin.actions";
import { BannerImageUpload } from "@/modules/banners/presentation/components/banner-image-upload";
import type { BannerListItem } from "@/modules/banners/application/queries/banners";

/**
 * Banner create/edit form. Status changes are explicit (publishing never
 * happens by accident); validation and authorization live server-side.
 */
export function BannerForm({ initial }: { initial?: BannerListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [image, setImage] = useState(initial?.image ?? "");
  const [mobileImage, setMobileImage] = useState(initial?.mobileImage ?? "");

  const onSubmit = (form: FormData) => {
    const payload = {
      ...(initial ? { id: initial.id } : {}),
      title: String(form.get("title") ?? ""),
      subtitle: String(form.get("subtitle") ?? ""),
      image,
      mobileImage,
      link: String(form.get("link") ?? ""),
      sortOrder: String(form.get("sortOrder") ?? ""),
      startsAt: String(form.get("startsAt") ?? ""),
      endsAt: String(form.get("endsAt") ?? ""),
      status: String(form.get("status") ?? "DRAFT"),
    };
    startTransition(async () => {
      const res = initial
        ? await updateBannerAction(payload)
        : await createBannerAction(payload);
      if (res.ok) {
        toast.success(initial ? "Banner updated." : "Banner created.");
        router.push("/admin/banners");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // Stored walls are UTC; render them as UTC so the submit path (which
  // interprets input as UTC) round-trips without a timezone shift.
  const toInput = (d: Date | null) => {
    if (!d) return "";
    const date = new Date(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  };

  return (
    <form
      action={onSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-foreground/10"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={initial?.title ?? ""} placeholder="Summer Sale" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "DRAFT"}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="DRAFT">Draft (hidden)</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired (hidden)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="subtitle">Subtitle (optional)</Label>
          <Textarea id="subtitle" name="subtitle" defaultValue={initial?.subtitle ?? ""} rows={2} />
        </div>
        <BannerImageUpload
          bannerId={initial?.id ?? null}
          desktopValue={image}
          mobileValue={mobileImage}
          onDesktopChange={setImage}
          onMobileChange={setMobileImage}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="link">Destination link (optional)</Label>
          <Input
            id="link"
            name="link"
            defaultValue={initial?.link ?? ""}
            placeholder="/collections/summer-essentials"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Site path (/…) or https URL.</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sortOrder">Display order (optional)</Label>
          <Input
            id="sortOrder"
            name="sortOrder"
            defaultValue={initial?.sortOrder?.toString() ?? ""}
            placeholder="0"
            inputMode="numeric"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="startsAt">Starts at, UTC (optional)</Label>
          <Input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            defaultValue={toInput(initial?.startsAt ? new Date(initial.startsAt) : null)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="endsAt">Ends at, UTC (optional, blank = open-ended)</Label>
          <Input
            id="endsAt"
            name="endsAt"
            type="datetime-local"
            defaultValue={toInput(initial?.endsAt ? new Date(initial.endsAt) : null)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} type="submit">
          {pending ? <Spinner className="size-4" /> : null}
          {initial ? "Save changes" : "Create banner"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => router.back()}>
          Back
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only ACTIVE banners inside their time window appear on the storefront.
      </p>
    </form>
  );
}
