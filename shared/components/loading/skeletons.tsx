import { Skeleton } from "@/shared/components/ui/skeleton";

/**
 * Loading skeletons shared by the route-boundary `loading.tsx` files
 * (GP-23 / T-3.1). Server-safe by design — no state, no browser APIs.
 * Surfaces use the existing token classes (muted placeholders on the cream
 * background) so boundaries never become a second design system.
 */

/** Admin console: header line + toolbar + table rows. */
export function AdminTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="rounded-xl bg-white ring-1 ring-foreground/10">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-96" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="border-b border-border/50 px-4 py-4 last:border-0">
            <Skeleton className="h-4 w-full max-w-3xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Storefront: heading + filter row + product card grid. */
export function CardGridSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-64" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-9 w-44" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[4/5] w-full rounded-xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Auth group: narrow centered form card. */
export function AuthCardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-16" aria-busy="true" aria-live="polite">
      <Skeleton className="mx-auto h-10 w-40" />
      <div className="rounded-2xl bg-white p-6 ring-1 ring-foreground/10">
        <Skeleton className="mb-2 h-6 w-2/3" />
        <Skeleton className="mb-6 h-4 w-1/2" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="mb-4 h-10 w-full" />
        ))}
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
