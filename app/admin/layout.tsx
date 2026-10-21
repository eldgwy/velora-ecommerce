import Link from "next/link";

import { ADMIN_LINKS } from "@/shared/constants";
import { requireAdmin } from "@/shared/lib/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth behind the proxy: only staff ever render this shell.
  const session = await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <Link
            href="/admin"
            className="mr-2 text-lg font-bold tracking-[0.2em] text-velora-emerald"
          >
            VELORA · ADMIN
          </Link>
          {ADMIN_LINKS.map((link) => (
            <Link
              key={link.url}
              href={link.url}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.title}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <span className="rounded-full bg-velora-emerald/10 px-3 py-1 text-xs font-semibold text-velora-emerald">
              {session.user.role}
            </span>
            <Link
              href="/"
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Store
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
