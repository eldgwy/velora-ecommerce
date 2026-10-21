"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { createVariant, updateVariant } from "@/shared/lib/actions/variants";
import { formatPrice } from "@/shared/lib/utils";

interface AdminOption {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
}

interface AdminVariant {
  id: string;
  sku: string | null;
  status: string;
  description: string | null;
  priceOverride: string | null;
  optionValues: Array<{ optionId: string; optionName: string; valueId: string; value: string }>;
  quantity: number;
  reservedQuantity: number;
}

function resolvePrice(variant: Pick<AdminVariant, "priceOverride">, basePrice: string): string {
  const override = Number(variant.priceOverride);
  if (variant.priceOverride && Number.isFinite(override) && override > 0) {
    return variant.priceOverride;
  }
  return basePrice;
}

/**
 * Variants + stock panel mirroring the storefront VariantSelector data shape
 * (option-name/value chips, availability). New variants start with 0 stock —
 * the Inventory panel (T-2.2) is where stock is set. Editing preserves the
 * variant's existing option binding (only sku/price/status are editable).
 */
export function VariantManagerPanel({
  productId,
  basePrice,
  options,
  variants,
}: {
  productId: string;
  basePrice: string;
  options: AdminOption[];
  variants: AdminVariant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const hasOptions = options.some((o) => o.values.length > 0);

  const onCreate = (form: FormData) => {
    const optionValueIds = form.getAll("optionValueId").map(String).filter(Boolean);
    const price = String(form.get("createPrice") ?? "").trim();
    const payload = {
      sku: String(form.get("createSku") ?? "").trim(),
      description: String(form.get("createDescription") ?? "").trim() || undefined,
      priceOverride: price.length > 0 ? Number(price) : undefined,
      status: String(form.get("createStatus") ?? "ACTIVE") as "DRAFT" | "ACTIVE" | "ARCHIVE",
      optionValueIds,
    };
    startTransition(async () => {
      const res = await createVariant(productId, payload);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Variant created — it starts with 0 stock; set stock in Inventory.");
      router.refresh();
    });
  };

  const onSave = (variant: AdminVariant, form: FormData) => {
    const price = String(form.get(`save-${variant.id}`) ?? "").trim();
    const payload = {
      sku: String(form.get(`sku-${variant.id}`) ?? "").trim(),
      description: String(form.get(`desc-${variant.id}`) ?? "").trim() || undefined,
      priceOverride: price.length > 0 ? Number(price) : undefined,
      status: String(form.get(`status-${variant.id}`) ?? variant.status) as
        | "DRAFT"
        | "ACTIVE"
        | "ARCHIVE",
    };
    startTransition(async () => {
      const res = await updateVariant(variant.id, payload);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Variant ${payload.sku || variant.id} saved.`);
      router.refresh();
    });
  };

  const available = (v: AdminVariant) => Math.max(0, v.quantity - v.reservedQuantity);

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-foreground/10">
      <h2 className="text-base font-semibold">
        Variants <span className="text-sm font-normal text-muted-foreground">({variants.length})</span>
      </h2>

      {variants.length === 0 ? (
        hasOptions ? (
          <p className="text-sm text-muted-foreground">No variants — create the first below.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            This product has no options yet, so it cannot have variants. Its single purchasable
            listing is the product itself; options must exist before variants can be created.
          </p>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-border/50">
          {variants.map((v) => (
            <li key={v.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{v.sku ?? "—"}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    v.status === "ACTIVE"
                      ? "bg-velora-emerald/10 text-velora-emerald"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {v.status}
                </span>
                <span className="text-muted-foreground">{formatPrice(resolvePrice(v, basePrice))}</span>
                <span className="text-xs text-muted-foreground">
                  stock {v.quantity} · reserved {v.reservedQuantity} · available {available(v)}
                </span>
                {available(v) <= 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Low / out of stock
                  </span>
                ) : null}
              </div>
              {v.optionValues.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {v.optionValues.map((ov) => (
                    <span
                      key={`${v.id}-${ov.valueId}`}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      {ov.optionName}: {ov.value}
                    </span>
                  ))}
                </div>
              ) : null}
              <form
                action={(form) => onSave(v, form)}
                className="mt-2 flex flex-wrap items-end gap-2"
              >
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`sku-${v.id}`}>SKU</Label>
                  <Input id={`sku-${v.id}`} name={`sku-${v.id}`} defaultValue={v.sku ?? ""} maxLength={64} className="w-40" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`save-${v.id}`}>Price override</Label>
                  <Input
                    id={`save-${v.id}`}
                    name={`save-${v.id}`}
                    type="number"
                    step="0.01"
                    min="0.01"
                    defaultValue={v.priceOverride ?? ""}
                    className="w-32"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`status-${v.id}`}>Status</Label>
                  <select
                    id={`status-${v.id}`}
                    name={`status-${v.id}`}
                    defaultValue={v.status}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {["DRAFT", "ACTIVE", "ARCHIVE"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <input type="hidden" name={`desc-${v.id}`} defaultValue={v.description ?? ""} />
                <Button type="submit" size="sm" disabled={pending}>
                  Save
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {hasOptions ? (
        <form action={onCreate} className="flex flex-col gap-3 border-t border-border/50 pt-4">
          <h3 className="text-sm font-semibold">New variant</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-sku">SKU</Label>
              <Input id="create-sku" name="createSku" maxLength={64} autoComplete="off" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-price">Price override (optional)</Label>
              <Input id="create-price" name="createPrice" type="number" step="0.01" min="0.01" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-status">Status</Label>
              <select id="create-status" name="createStatus" defaultValue="ACTIVE" className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {["ACTIVE", "DRAFT", "ARCHIVE"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-desc">Description (optional)</Label>
              <Input id="create-desc" name="createDescription" maxLength={500} autoComplete="off" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {options
              .filter((o) => o.values.length > 0)
              .map((o) => (
                <fieldset key={o.id} className="flex flex-wrap items-center gap-2">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {o.name}
                  </legend>
                  {o.values.map((val) => (
                    <label key={val.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="optionValueId" value={val.id} className="size-4" />
                      {val.value}
                    </label>
                  ))}
                </fieldset>
              ))}
          </div>
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Spinner /> : null} Create variant
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
