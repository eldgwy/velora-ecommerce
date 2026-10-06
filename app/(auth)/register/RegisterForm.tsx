"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailCheckIcon,
  MailIcon,
  ShieldCheckIcon,
  UserIcon,
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
  FieldSeparator,
} from "@/shared/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { Spinner } from "@/shared/components/ui/spinner";
import { RegisterFormValues, registerSchema } from "@/shared/types/auth";
import GoogleIcon from "@/shared/components/GoogleIcon";

const RegisterFormContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [isLoading, setIsLoading] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  // Strict email verification – the account has no session until it's confirmed.
  const [registeredEmail, setRegisteredEmail] = React.useState<string | null>(
    null,
  );
  const [isResending, setIsResending] = React.useState(false);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: RegisterFormValues) {
    setIsLoading(true);
    try {
      const { data: sessionData, error } = await authClient.signUp.email({
        name: data.name,
        email: data.email,
        password: data.password,
        callbackURL: callbackUrl,
      });

      if (error) {
        toast.error(
          error.message || "Failed to create account. Please try again.",
        );
        setIsLoading(false);
        return;
      }

      // With email verification required, no session is issued at sign-up, so
      // show the "check your inbox" screen instead of redirecting.
      if (!sessionData?.token) {
        setRegisteredEmail(data.email);
        toast.success(
          "Account created! Check your inbox to verify your email address.",
        );
        return;
      }

      toast.success("Account created successfully! Welcome to Velora.");
      router.push(callbackUrl);
      router.refresh();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during registration.";
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  /** Re-send the verification link to the address that just signed up. */
  async function handleResendVerification() {
    if (!registeredEmail) return;

    setIsResending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: registeredEmail,
      });

      if (error) {
        toast.error(
          error.message || "Couldn't send the verification email. Try again.",
        );
        return;
      }

      toast.success(`Verification email re-sent to ${registeredEmail}.`);
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

  async function handleGoogleSignIn() {
    setIsGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: callbackUrl,
      });
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to initiate Google sign-in.";
      toast.error(errorMessage);
      setIsGoogleLoading(false);
    }
  }

  if (registeredEmail) {
    return (
      <Card className="w-full sm:max-w-md shadow-lg border-border/40">
        <CardHeader className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-velora-emerald/10 text-velora-emerald">
            <MailCheckIcon className="size-6" />
          </span>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Check your email
          </CardTitle>
          <CardDescription>
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">
              {registeredEmail}
            </span>
            . Open it to activate your Velora account before signing in.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full font-medium"
            onClick={handleResendVerification}
            disabled={isResending}
          >
            {isResending ? (
              <Spinner className="size-4" />
            ) : (
              <ShieldCheckIcon className="size-4" />
            )}
            <span>
              {isResending ? "Sending..." : "Resend verification email"}
            </span>
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Didn&apos;t receive it? Check your spam folder, or{" "}
            <button
              type="button"
              onClick={() => setRegisteredEmail(null)}
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

  return (
    <Card className="w-full sm:max-w-md shadow-lg border-border/40">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Create an account
        </CardTitle>
        <CardDescription>
          Join Velora to start shopping and track your orders
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Google OAuth Quick Signup */}
        <Button
          type="button"
          variant="outline"
          className="w-full flex items-center justify-center gap-2"
          onClick={handleGoogleSignIn}
          disabled={isGoogleLoading || isLoading}
        >
          {isGoogleLoading ? (
            <Spinner className="size-4" />
          ) : (
            <GoogleIcon className="size-4 shrink-0" />
          )}
          <span>Sign up with Google</span>
        </Button>

        <FieldSeparator>or register with email</FieldSeparator>

        {/* Registration Form */}
        <form id="register-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="space-y-4">
            {/* Full Name Field */}
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="register-name">Full Name</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <UserIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="register-name"
                      type="text"
                      placeholder="Jane Doe"
                      autoComplete="name"
                      disabled={isLoading || isGoogleLoading}
                      aria-invalid={fieldState.invalid}
                    />
                  </InputGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Email Address Field */}
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="register-email">
                    Email Address
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <MailIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="register-email"
                      type="email"
                      placeholder="name@example.com"
                      autoComplete="email"
                      disabled={isLoading || isGoogleLoading}
                      aria-invalid={fieldState.invalid}
                    />
                  </InputGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Password Field */}
            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="register-password">Password</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <LockIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="register-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="8+ chars with upper, lower, number & symbol"
                      autoComplete="new-password"
                      disabled={isLoading || isGoogleLoading}
                      aria-invalid={fieldState.invalid}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        disabled={isLoading || isGoogleLoading}
                      >
                        {showPassword ? (
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

            {/* Confirm Password Field */}
            <Controller
              name="confirmPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="register-confirm-password">
                    Confirm Password
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <LockIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="register-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter your password"
                      autoComplete="new-password"
                      disabled={isLoading || isGoogleLoading}
                      aria-invalid={fieldState.invalid}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={
                          showConfirmPassword
                            ? "Hide confirm password"
                            : "Show confirm password"
                        }
                        disabled={isLoading || isGoogleLoading}
                      >
                        {showConfirmPassword ? (
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
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button
          type="submit"
          form="register-form"
          className="w-full font-medium"
          disabled={isLoading || isGoogleLoading}
        >
          {isLoading && <Spinner className="size-4 mr-2" />}
          <span>{isLoading ? "Creating account..." : "Create account"}</span>
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
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

export default RegisterFormContent;
