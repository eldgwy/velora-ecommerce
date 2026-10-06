import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import Link from "next/link";

/**
 * Shared placeholder for the not-yet-built admin sections. Lives in its own
 * module so pages never have to import from `layout.tsx`.
 */
export function AdminPlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="w-full shadow-lg border-border/40">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This section is protected by the role-based guard — only accounts with
          the `ADMIN` or `STAFF` role can reach it. The management UI lands here
          in a later milestone.
        </p>
      </CardContent>
      <CardFooter>
        <Link
          href="/"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to the store
        </Link>
      </CardFooter>
    </Card>
  );
}
