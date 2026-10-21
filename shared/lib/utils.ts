// Single class-merge implementation: the `cn` package is shadcn's maintained
// zero-dependency engine (clsx-style joining + tailwind-merge conflict
// resolution in one). clsx and tailwind-merge are no longer separate
// dependencies; everything merges through this re-export or `from "cn"`.
export { cn } from "cn";

export function formatPrice(price: string | number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(price));
}
