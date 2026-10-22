import { EmptyState } from "@/shared/components/ui/empty-state";
import { AdminPagination, parsePageParam } from "@/shared/components/ui/pagination";

import Link from "next/link";

import { formatDate } from "@/shared/lib/format";
import { listUsersForAdmin } from "@/services/user-admin.service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Customers — VELORA Admin",
};

const STATUSES = ["all", "ACTIVE", "NOTACTIVE"] as const;

interface CustomersPageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

const PAGE_SIZE = 20;

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? (params.status as (typeof STATUSES)[number])
    : undefined;
  const page = parsePageParam(params.page);

  const { items, total, totalPages } = await listUsersForAdmin({
    query: params.q,
    status: !status || status === "all" ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });

  const pageHref = (p: number) =>
    `/admin/customers?${new URLSearchParams({
      ...(params.q ? { q: params.q } : {}),
      ...(status ? { status } : {}),
      page: String(p),
    }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} account{total === 1 ? "" : "s"} · status and role changes are audited with your admin id
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" action="/admin/customers">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name or email…"
          aria-label="Search accounts"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <select name="status" defaultValue={status ?? "all"} aria-label="Filter by status" className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState title="No accounts match" description="Search by name or email, or clear the filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${a.id}`} className="font-medium underline-offset-4 hover:underline">
                      {a.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{a.email}</span>
                    {!a.emailVerified ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">unverified</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{a.role}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        a.status === "ACTIVE"
                          ? "bg-velora-emerald/10 text-velora-emerald"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination currentPage={page} totalPages={totalPages} buildHref={pageHref} ariaLabel="Customer pages" />
    </div>
  );
}
