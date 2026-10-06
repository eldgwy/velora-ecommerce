"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  MailIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { authClient } from "@/shared/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/shared/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { Spinner } from "@/shared/components/ui/spinner";
import { ERROR_MESSAGES, VerificationStatus } from "@/shared/types/auth";

const FALLBACK_ERROR_MESSAGE =
  "We couldn't verify your email address. The link may be invalid or expired.";

// ─── Verify Email ───────────────────────────────────────────────────────────

const VerifyEmailContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get("token");
  const errorCode = searchParams.get("error");
  const callbackUrl =
    searchParams.get("callbackURL") || "/login?verified=1";

  const [status, setStatus] = React.useState<VerificationStatus>("verifying");
  const [message, setMessage] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [isResending, setIsResending] = React.useState(false);

  // Guard so React StrictMode's double effect doesn't fire two verify calls.
  const hasAttemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (hasAttemptedRef.current) return;
    hasAttemptedRef.current = true;

    async function verify() {
      if (errorCode) {
        setStatus("error");
        setMessage(ERROR_MESSAGES[errorCode] ?? FALLBACK_ERROR_MESSAGE);
        return;
      }

      if (!token) {
        setStatus("error");
        setMessage(
          "This link is missing its verification token. Request a fresh link below.",
        );
        return;
      }

      try {
        const { error } = await authClient.verifyEmail({ query: { token } });

        if (error) {
          setStatus("error");
          setMessage(error.message || FALLBACK_ERROR_MESSAGE);
          return;
        }

        setStatus("success");
        toast.success("Email verified successfully!");
      } catch (err: unknown) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : FALLBACK_ERROR_MESSAGE);
      }
    }

    void verify();
  }, [errorCode, token]);

  async function handleResend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      toast.error("Enter the email address you registered with.");
      return;
    }

    setIsResending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: trimmedEmail,
        callbackURL: callbackUrl,
      });

      if (error) {
        toast.error(
          error.message || "Couldn't send the verification email. Try again.",
        );
        return;
      }

      toast.success(
        `A new verification link is on its way to ${trimmedEmail}.`,
      );
      setEmail("");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't send the verification email. Try again.",
      );
    } finally {
      setIsResending(false);
    }
  }

  if (status === "verifying") {
    return (
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            Verifying your email
          </CardTitle>
          <CardDescription>
            Hang tight — this only takes a moment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Spinner className="size-6 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-velora-emerald/10 text-velora-emerald">
            <BadgeCheckIcon className="size-6" />
          </span>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Email verified
          </CardTitle>
          <CardDescription>
            Your Velora account is active. Sign in to start shopping.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="button"
            className="w-full font-medium"
            onClick={() => router.push(callbackUrl)}
          >
            Continue
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Wrong account?{" "}
            <Link
              href="/login"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full sm:max-w-md shadow-lg border-border/40">
      <CardHeader className="space-y-3 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <AlertTriangleIcon className="size-6" />
        </span>
        <CardTitle className="text-2xl font-bold tracking-tight">
          Verification failed
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={handleResend}>
          <FieldGroup className="space-y-3">
            <Field>
              <FieldLabel htmlFor="verify-email-address">
                Resend verification email
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <MailIcon className="size-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  id="verify-email-address"
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isResending}
                />
              </InputGroup>
            </Field>
            <Button
              type="submit"
              variant="outline"
              className="w-full font-medium"
              disabled={isResending}
            >
              {isResending ? (
                <Spinner className="size-4" />
              ) : (
                <ShieldCheckIcon className="size-4" />
              )}
              <span>{isResending ? "Sending..." : "Send new link"}</span>
            </Button>
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <p className="text-center text-xs text-muted-foreground">
          Already verified?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
};

export default VerifyEmailContent;
