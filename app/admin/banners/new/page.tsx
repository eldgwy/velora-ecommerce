import { BannerForm } from "@/modules/banners/presentation/components/banner-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New banner — VELORA Admin",
};

export default function NewBannerPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New banner</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Starts as a draft. Publish explicitly when the creative and schedule are ready.
        </p>
      </div>
      <BannerForm />
    </div>
  );
}
