import { ShieldAlertIcon } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <ShieldAlertIcon className="size-6" />
          </span>
          <p className="text-sm font-bold tracking-[0.3em] text-muted-foreground">
            403 · FORBIDDEN
          </p>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Access denied
          </CardTitle>
          <CardDescription>
            Your account doesn&apos;t have permission to open this page.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
          >
            Back to the store
          </Link>
          <Link
            href="/login"
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Sign in with another account
          </Link>
        </CardFooter>
        <CardContent>
          <p className="text-center text-xs text-muted-foreground">
            Think this is wrong? Contact store support.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
