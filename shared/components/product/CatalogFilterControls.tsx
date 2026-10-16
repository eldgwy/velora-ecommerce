"use client";

function updateParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  url.searchParams.delete("page");
  window.location.href = url.toString();
}

export function InStockCheckbox({ checked }: { checked: boolean }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        name="inStock"
        checked={checked}
        onChange={(e) => {
          updateParam("inStock", e.target.checked ? "true" : null);
        }}
        className="checkbox"
      />
      <span className="text-sm">In Stock Only</span>
    </label>
  );
}

export function RatingFilter({ selected }: { selected?: string }) {
  return (
    <div className="space-y-1">
      {[4, 3, 2, 1].map((stars) => (
        <label key={stars} className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="rating"
            value={String(stars)}
            checked={selected === String(stars)}
            onChange={(e) => {
              updateParam("rating", e.target.checked ? e.target.value : null);
            }}
            className="radio"
          />
          <span className="text-sm flex items-center gap-1">
            {"★".repeat(stars)}
            {"☆".repeat(5 - stars)}
            <span className="text-muted-foreground"> & Up</span>
          </span>
        </label>
      ))}
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
      className="select select-sm w-auto"
      aria-label="Sort products"
    >
      <option value="newest">Newest</option>
      <option value="price_asc">Price: Low to High</option>
      <option value="price_desc">Price: High to Low</option>
      <option value="rating">Top Rated</option>
    </select>
  );
}
