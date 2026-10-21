"use client";

function updateParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  // searchParams.delete is URL manipulation, not drizzle — rule FPs here.
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams, not drizzle
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams, not drizzle
  url.searchParams.delete("page");
  window.location.href = url.toString();
}

export function InStockCheckbox({
  checked,
  count,
}: {
  checked: boolean;
  /** Facet count of in-stock matches under the other applied filters. */
  count?: number;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        name="inStock"
        checked={checked}
        onChange={(e) => {
          updateParam("inStock", e.target.checked ? "true" : null);
        }}
        className="size-4 accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-(--ring) focus-visible:outline-offset-2 disabled:opacity-50"
      />
      <span className="text-sm">
        In Stock Only
        {" "}
        {count !== undefined && count > 0 ? (
          <span className="text-xs text-muted-foreground">({count})</span>
        ) : null}
      </span>
    </label>
  );
}

/** Facet counts as "& up" aggregates (rating >= N), index 0 unused. */
type RatingBandCounts = Array<{ rating: number; count: number }>;

function countRatingsAtLeast(bands: RatingBandCounts, stars: number): number {
  return bands
    .filter((b) => b.rating >= stars)
    .reduce((sum, b) => sum + b.count, 0);
}

export function RatingFilter({
  selected,
  bandCounts,
}: {
  selected?: string;
  bandCounts?: RatingBandCounts;
}) {
  return (
    <div className="space-y-1">
      {[4, 3, 2, 1].map((stars) => {
        const atLeast = bandCounts ? countRatingsAtLeast(bandCounts, stars) : undefined;
        return (
          <label key={stars} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="rating"
              value={String(stars)}
              checked={selected === String(stars)}
              onChange={(e) => {
                updateParam("rating", e.target.checked ? e.target.value : null);
              }}
              className="size-4 accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-(--ring) focus-visible:outline-offset-2 disabled:opacity-50"
            />
            <span className="text-sm flex items-center gap-1">
              {"★".repeat(stars)}
              {"☆".repeat(5 - stars)}
              <span className="text-muted-foreground"> & Up</span>
              {atLeast !== undefined && atLeast > 0 ? (
                <span className="text-xs text-muted-foreground">({atLeast})</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function SortSelect({ value }: { value: string }) {
  return (
    <select
      value={value}
      onChange={(e) => {
        updateParam("sort", e.target.value);
      }}
      className="h-8 w-auto rounded-lg border border-(--input) bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-(--ring) focus-visible:ring-3 focus-visible:ring-(--ring)/50 cursor-pointer"
      aria-label="Sort products"
    >
      <option value="newest">Newest</option>
      <option value="price_asc">Price: Low to High</option>
      <option value="price_desc">Price: High to Low</option>
      <option value="rating">Top Rated</option>
    </select>
  );
}
