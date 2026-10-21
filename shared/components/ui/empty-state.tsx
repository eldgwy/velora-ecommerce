import type { ReactNode } from "react";

import { cn } from "cn";

/**
 * Design-system empty state (T-3.2). The one component every list/detail
 * surface uses for its no-data view — a muted centered panel on the cream
 * background, optional action slot. A surface is never allowed to fake data
 * (GP-02 lesson) or to invent its own empty-state styling.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  /** Optional CTA — e.g. a "Create" button linking to the matching form. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl bg-white px-6 py-14 text-center ring-1 ring-foreground/10",
        className,
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.25em] text-velora-emerald/70">
        Nothing here yet
      </span>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
