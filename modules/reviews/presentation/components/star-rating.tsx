"use client";

import { useState } from "react";

/**
 * Accessible star-rating input (radio group, keyboard operable, labelled).
 * Controlled value 0 = no selection.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  return (
    <div
      role="radiogroup"
      aria-label="Your rating"
      className="flex items-center gap-1"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onFocus={() => setHovered(star)}
          className="rounded p-0.5 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        >
          <svg
            className={`size-7 ${star <= shown ? "fill-amber-500 text-amber-500" : "fill-transparent text-border"}`}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
      <span className="ml-2 text-sm text-muted-foreground" aria-live="polite">
        {shown > 0 ? `${shown} of 5` : "Select a rating"}
      </span>
    </div>
  );
}

/**
 * Read-only star display with a text equivalent (never color-alone).
 */
export function StarRatingDisplay({ rating, className }: { rating: number | null; className?: string }) {
  const safe = typeof rating === "number" && rating >= 1 && rating <= 5 ? rating : 0;
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`} role="img" aria-label={`Rated ${safe} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`size-4 ${star <= Math.round(safe) ? "fill-amber-500 text-amber-500" : "fill-transparent text-border"}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}
