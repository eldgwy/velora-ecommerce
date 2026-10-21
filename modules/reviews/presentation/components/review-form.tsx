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
  ALLOWED_IMAGE_TYPES,
  validateImageFile,
} from "@/shared/lib/image-validation";
import { StarRatingInput } from "@/modules/reviews/presentation/components/star-rating";
import {
  getReviewImageUploadParamsAction,
  submitReviewAction,
} from "@/modules/reviews/presentation/actions/review.actions";

const MAX_FILES = 4;

async function uploadOne(
  file: File,
  params: {
    timestamp: number;
    signature: string;
    apiKey: string;
    cloudName: string;
    folder: string;
    uploadPreset?: string;
  },
): Promise<{ url: string; publicId: string }> {
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
  if (!res.ok) throw new Error("Image upload failed.");
  const body = (await res.json()) as { secure_url?: string; public_id?: string };
  if (!body.secure_url || !body.public_id) throw new Error("Image upload failed.");
  return { url: body.secure_url, publicId: body.public_id };
}

/**
 * Customer review form. Rating + optional title/body/photos; photos upload
 * directly to the image provider with server-signed params, then the review
 * submits with the returned references. New reviews enter moderation and
 * appear publicly only after approval.
 */
export function ReviewForm({ productId, signedIn }: { productId: string; signedIn: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(0);
  const [files, setFiles] = useState<File[]>([]);

  if (!signedIn) {
    return (
      <p className="text-sm text-muted-foreground">
        Please sign in to write a review.
      </p>
    );
  }

  const onSubmit = (form: FormData) => {
    if (rating < 1 || rating > 5) {
      toast.error("Please select a rating from 1 to 5 stars.");
      return;
    }
    if (files.length > MAX_FILES) {
      toast.error(`At most ${MAX_FILES} photos per review.`);
      return;
    }
    for (const file of files) {
      const check = validateImageFile({ mimeType: file.type, size: file.size, filename: file.name });
      if (!check.valid) {
        toast.error(`"${file.name}": ${check.error}`);
        return;
      }
    }
    startTransition(async () => {
      try {
        let images: Array<{ url: string; publicId: string }> = [];
        if (files.length > 0) {
          const paramsRes = await getReviewImageUploadParamsAction();
          if (!paramsRes.ok || !paramsRes.data) {
            toast.error(paramsRes.ok ? "Upload unavailable." : paramsRes.error);
            return;
          }
          images = [];
          for (const file of files) {
            images.push(await uploadOne(file, paramsRes.data.params));
          }
        }
        const res = await submitReviewAction({
          productId,
          rating,
          title: String(form.get("title") ?? ""),
          content: String(form.get("content") ?? ""),
          images,
        });
        if (res.ok) {
          toast.success("Thanks! Your review is awaiting moderation.");
          setRating(0);
          setFiles([]);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form action={onSubmit} className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <h3 className="text-base font-semibold">Write a review</h3>
      <StarRatingInput value={rating} onChange={setRating} disabled={pending} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-title">Title (optional)</Label>
        <Input id="review-title" name="title" maxLength={120} placeholder="Summing it up" autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-content">Review (optional)</Label>
        <Textarea
          id="review-content"
          name="content"
          maxLength={5000}
          rows={4}
          placeholder="What did you think of this product?"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-photos">Photos (optional, up to {MAX_FILES})</Label>
        <Input
          id="review-photos"
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          multiple
          onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, MAX_FILES))}
        />
        {files.length > 0 ? (
          <p className="text-xs text-muted-foreground">{files.length} photo{files.length === 1 ? "" : "s"} selected.</p>
        ) : null}
      </div>
      <Button size="sm" disabled={pending} type="submit" className="self-start">
        {pending ? <Spinner className="size-4" /> : null}
        Submit review
      </Button>
      <p className="text-xs text-muted-foreground">
        Reviews appear publicly after moderation. Verified-buyer status is determined automatically.
      </p>
    </form>
  );
}
