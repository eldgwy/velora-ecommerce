import { CouponForm } from "@/modules/coupons/presentation/components/coupon-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "New coupon — VELORA Admin",
};

export default function NewCouponPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">New coupon</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codes normalize to uppercase A–Z, 0–9, dash, underscore.
        </p>
      </div>
      <CouponForm />
    </div>
  );
}
