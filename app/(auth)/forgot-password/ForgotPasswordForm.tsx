"use client";

import * as React from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { MailIcon } from "lucide-react";
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  forgotPasswordSchema,
  ForgotPasswordFormValues,
} from "@/shared/types/auth";

const RESEND_COOLDOWN_SECONDS = 30;

const ForgotPasswordForm = () => {
  const [isLoading, setIsLoading] = React.useState(false);
  const [requestedEmail, setRequestedEmail] = React.useState<string | null>(
    null,
  );
  const [cooldown, setCooldown] = React.useState(0);
  const cooldownTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  React.useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);

    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);

    cooldownTimerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1 && cooldownTimerRef.current) {
          clearInterval(cooldownTimerRef.current);
        }

        return Math.max(prev - 1, 0);
      });
    }, 1000);
  }

  async function requestReset(email: string) {
    // FR-01.05: generic copy regardless — the API answers identically
    // whether or not the address exists, so accounts can't be enumerated.
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });

    if (error) {
      toast.error(error.message || "Couldn't send the reset email. Try again.");
      return false;
    }

    setRequestedEmail(email);
    startCooldown();
    return true;
  }

  async function onSubmit(data: ForgotPasswordFormValues) {
    setIsLoading(true);
    try {
      await requestReset(data.email.trim());
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  // ── Success: "check your email" state ──────────────────────────────────
  if (requestedEmail) {
    return (
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            Check your email
          </CardTitle>
          <CardDescription>
            If <span className="font-semibold">{requestedEmail}</span> has a
            Velora account, a password-reset link is on its way. The link
            expires in 60 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full font-medium"
            disabled={cooldown > 0}
            onClick={async () => {
              await requestReset(requestedEmail);
            }}
          >
            <span>
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend reset email"}
            </span>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Didn&apos;t receive it? Check your spam folder, or{" "}
            <button
              type="button"
              onClick={() => setRequestedEmail(null)}
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              use another email
            </button>
            .
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Link
            href="/login"
            className="text-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  // ── Request form ───────────────────────────────────────────────────────
  return (
    <Card className="w-full sm:max-w-md shadow-lg border-border/40">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Forgot your password?
        </CardTitle>
        <CardDescription>
          Enter the email you signed up with and we&apos;ll send you a reset
          link
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit(onSubmit)(event);
          }}
          id="forgot-password-form"
        >
          <FieldGroup className="space-y-4">
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <MailIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="forgot-email"
                      type="email"
                      placeholder="name@example.com"
                      autoComplete="email"
                      disabled={isLoading}
                      aria-invalid={fieldState.invalid}
                    />
                  </InputGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button
          type="submit"
          form="forgot-password-form"
          className="w-full font-medium"
          disabled={isLoading}
        >
          {isLoading && <Spinner className="size-4 mr-2" />}
          <span>{isLoading ? "Sending..." : "Send reset link"}</span>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Remember it now?{" "}
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

export default ForgotPasswordForm;
