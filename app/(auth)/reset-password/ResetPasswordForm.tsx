"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  resetPasswordSchema,
  ResetPasswordFormValues,
} from "@/shared/types/auth";

// ─── Reset Password ────────────────────────────────────────────────────────

const ResetPasswordForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get("token");
  const errorCode = searchParams.get("error");

  const [isLoading, setIsLoading] = React.useState(false);
  const [showPasswords, setShowPasswords] = React.useState(false);
  const [isDone, setIsDone] = React.useState(false);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordFormValues) {
    if (!token) {
      toast.error("This reset link is missing its token. Request a new one.");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await authClient.resetPassword({
        token,
        newPassword: data.newPassword,
      });

      if (error) {
        toast.error(
          error.message ||
            "We couldn't reset your password. Request a new link.",
        );
        return;
      }

      setIsDone(true);
      toast.success("Password updated — sign in with your new password.");
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

  // ── Invalid / expired link ─────────────────────────────────────────────
  if (errorCode || !token) {
    return (
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertTriangleIcon className="size-6" />
          </span>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Reset link failed
          </CardTitle>
          <CardDescription>
            This link is missing its reset token, or it was already used.
            Request a fresh link below.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3">
          <Link
            href="/forgot-password"
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
          >
            Request a new link
          </Link>
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
  }

  // ── Success: password changed ──────────────────────────────────────────
  if (isDone) {
    return (
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-velora-emerald/10 text-velora-emerald">
            <BadgeCheckIcon className="size-6" />
          </span>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Password updated
          </CardTitle>
          <CardDescription>
            Your password has been changed and every other session was signed
            out. Sign in with your new password.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="button"
            className="w-full font-medium"
            onClick={() => router.push("/login?reset=1")}
          >
            Continue to sign in
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // ── New-password form ──────────────────────────────────────────────────
  return (
    <Card className="w-full sm:max-w-md shadow-lg border-border/40">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Choose a new password
        </CardTitle>
        <CardDescription>
           8+ characters with an uppercase letter, a number, and a symbol.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form id="reset-password-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="space-y-4">
            <Controller
              name="newPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="reset-new-password">
                    New password
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <LockIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="reset-new-password"
                      type={showPasswords ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      disabled={isLoading}
                      aria-invalid={fieldState.invalid}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setShowPasswords((prev) => !prev)}
                        aria-label={
                          showPasswords ? "Hide passwords" : "Show passwords"
                        }
                        disabled={isLoading}
                      >
                        {showPasswords ? (
                          <EyeOffIcon className="size-4" />
                        ) : (
                          <EyeIcon className="size-4" />
                        )}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="confirmPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="reset-confirm-password">
                    Confirm new password
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <ShieldCheckIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="reset-confirm-password"
                      type={showPasswords ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
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
          form="reset-password-form"
          className="w-full font-medium"
          disabled={isLoading}
        >
          {isLoading && <Spinner className="size-4 mr-2" />}
          <span>{isLoading ? "Resetting..." : "Reset password"}</span>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Link expired?{" "}
          <Link
            href="/forgot-password"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Request a new one
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
};

export default ResetPasswordForm;
