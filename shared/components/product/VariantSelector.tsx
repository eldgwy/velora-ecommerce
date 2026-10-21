"use client";

import { useState, useMemo } from "react";
import { formatPrice } from "@/shared/lib/utils";
import { AddToCartButton } from "@/shared/components/product/AddToCartButton";

interface ProductVariant {
  id: string;
  sku: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVE";
  priceOverride: string | null;
  optionValues: Array<{
    optionId: string;
    optionName: string;
    valueId: string;
    value: string;
  }>;
  availableStock: number;
}

interface ProductOption {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
}

interface Product {
  id: string;
  name: string;
  basePrice: string;
  comparePrice: string | null;
  variants: ProductVariant[];
  options: ProductOption[];
}

interface VariantSelectorProps {
  product: Product;
  /** Precomputed promotion views by variant id (server-side, authoritative). */
  promotionViews?: Record<
    string,
    {
      effectivePrice: string;
      listPrice: string;
      promotionName: string | null;
      endsAt: string | null;
    }
  >;
}

function findMatchingVariant(
  product: Product,
  selectedValues: Record<string, string>
): ProductVariant | null {
  const optionIds = Object.keys(selectedValues);
  if (optionIds.length === 0) return null;

  // Check if all required options are selected
  const requiredOptionIds = product.options.map((o) => o.id);
  const allSelected = requiredOptionIds.every((id) => selectedValues[id]);

  if (!allSelected) return null;

  return (
    product.variants.find((variant) => {
      if (variant.status !== "ACTIVE") return false;
      return requiredOptionIds.every((optionId) => {
        const selectedValueId = selectedValues[optionId];
        return variant.optionValues.some(
          (ov) => ov.optionId === optionId && ov.valueId === selectedValueId
        );
      });
    }) ?? null
  );
}

export function VariantSelector({ product, promotionViews }: VariantSelectorProps) {
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});

  const resolvedVariant = useMemo(
    () => findMatchingVariant(product, selectedValues),
    [product, selectedValues]
  );

  const isCompleteSelection = useMemo(() => {
    const requiredOptionIds = product.options.map((o) => o.id);
    return requiredOptionIds.every((id) => selectedValues[id]);
  }, [product.options, selectedValues]);

  const availableStock = resolvedVariant?.availableStock ?? 0;
  const isInStock = availableStock > 0;
  const listPrice = resolvedVariant
    ? resolvedVariant.priceOverride ?? product.basePrice
    : product.basePrice;
  const promoView = resolvedVariant ? promotionViews?.[resolvedVariant.id] : undefined;
  const displayPrice = promoView?.effectivePrice ?? listPrice;
  const showPromoStrike =
    promoView !== undefined &&
    Number(promoView.effectivePrice) < Number(promoView.listPrice);

  const handleSelectValue = (optionId: string, valueId: string) => {
    setSelectedValues((prev) => ({ ...prev, [optionId]: valueId }));
  };

  if (product.options.length === 0) {
    // Simple product (no options): resolve the default purchasable variant
    // the same way wishlist move-to-cart does — first ACTIVE variant.
    const defaultVariant =
      product.variants.find((v) => v.status === "ACTIVE") ?? null;
    const simpleInStock = (defaultVariant?.availableStock ?? 0) > 0;

    return (
      <div className="mt-2 space-y-3">
        {defaultVariant && defaultVariant.sku && (
          <p className="text-sm text-muted-foreground font-mono">
            SKU: {defaultVariant.sku}
          </p>
        )}
        <AddToCartButton
          variantId={defaultVariant?.id ?? null}
          disabled={!simpleInStock}
          disabledLabel={defaultVariant ? "Out of Stock" : "Unavailable"}
          className="w-full"
        />
      </div>
    );
  }

  return (
    <fieldset className="space-y-4">
      <legend className="font-semibold">Select Options</legend>
      {product.options.map((option) => (
        <div key={option.id} className="space-y-2">
          <label className="font-medium">{option.name}</label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={option.name}>
            {option.values.map((value) => {
              const isSelected = selectedValues[option.id] === value.id;
              // Check if this value is available in any active variant
              const isAvailable = product.variants.some(
                (v) =>
                  v.status === "ACTIVE" &&
                  v.optionValues.some((ov) => ov.optionId === option.id && ov.valueId === value.id)
              );

              return (
                <button
                  key={value.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!isAvailable}
                  onClick={() => handleSelectValue(option.id, value.id)}
                  className={`
                    px-4 py-2 border rounded-lg text-sm transition-colors
                    ${isSelected
                      ? "border-primary bg-primary/5 text-primary"
                      : isAvailable
                      ? "hover:bg-accent"
                      : "opacity-40 cursor-not-allowed"
                    }
                    focus:outline-none focus:ring-2 focus:ring-ring
                  `}
                >
                  {value.value}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Resolved Variant Display */}
      {isCompleteSelection && (
        <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Selected Variant:</span>
            {resolvedVariant?.sku && (
              <span className="text-sm text-muted-foreground font-mono">SKU: {resolvedVariant.sku}</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold">{formatPrice(displayPrice)}</span>
            {showPromoStrike ? (
              <span className="text-lg line-through text-muted-foreground">
                {formatPrice(promoView!.listPrice)}
              </span>
            ) : null}
            {showPromoStrike && promoView!.promotionName ? (
              <span
                className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium"
                title={`Promotion: ${promoView!.promotionName}`}
              >
                Sale
              </span>
            ) : null}
            {product.comparePrice && Number(product.comparePrice) > Number(product.basePrice) && (
              <span className="text-lg line-through text-muted-foreground">{formatPrice(product.comparePrice)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isInStock ? (
              <>
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  In Stock ({availableStock} available)
                </span>
              </>
            ) : (
              <span className="text-sm text-red-600 flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Out of Stock
              </span>
            )}
          </div>

          {!resolvedVariant && (
            <p className="text-sm text-amber-600">
              This combination is not available. Please select a different option.
            </p>
          )}
        </div>
      )}

      {/* Purchase action */}
      <div className="pt-2">
        <AddToCartButton
          variantId={resolvedVariant?.id ?? null}
          disabled={!isCompleteSelection || !isInStock}
          disabledLabel={
            !isCompleteSelection
              ? "Select Options"
              : "Out of Stock"
          }
          className="w-full"
        />
      </div>
    </fieldset>
  );
}

export default VariantSelector;