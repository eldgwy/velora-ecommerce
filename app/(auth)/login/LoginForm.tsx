"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "lucide-react";
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
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Spinner } from "@/shared/components/ui/spinner";
import { loginSchema, LoginFormValues } from "@/shared/types/auth";
import GoogleIcon from "@/shared/components/GoogleIcon";

const LoginFormContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const justVerified = searchParams.get("verified") === "1";
  const justReset = searchParams.get("reset") === "1";

  const [isLoading, setIsLoading] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  // Landed here straight from the email verification link – greet once.
  const hasNotifiedVerificationRef = React.useRef(false);
  // Landed here after resetting the password – greet once.
  const hasNotifiedResetRef = React.useRef(false);

  React.useEffect(() => {
    if (!justVerified || hasNotifiedVerificationRef.current) return;

    hasNotifiedVerificationRef.current = true;
    toast.success("Email verified! Sign in to continue.");
  }, [justVerified]);

  React.useEffect(() => {
    if (!justReset || hasNotifiedResetRef.current) return;

    hasNotifiedResetRef.current = true;
    toast.success("Password updated! Sign in with your new password.");
  }, [justReset]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);
    try {
      const { error } = await authClient.signIn.email({
        email: data.email,
        password: data.password,
        callbackURL: callbackUrl,
        rememberMe: data.rememberMe,
      });

      if (error) {
        const errorMessage =
          error.message || "Invalid email or password. Please try again.";

        // Strict email verification blocks sign-in until the address is confirmed.
        if (/verif/i.test(errorMessage)) {
          toast.error("Your email isn't verified yet.", {
            description: "Open the link we emailed you, or request a new one.",
            action: {
              label: "Resend email",
              onClick: () => handleResendVerification(data.email),
            },
          });
        } else {
          toast.error(errorMessage);
        }

        setIsLoading(false);
        return;
      }

      toast.success("Welcome back! Signed in successfully.");
      router.push(callbackUrl);
      router.refresh();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during login.";
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  /** Send a fresh verification link when an unverified user tries to sign in. */
  async function handleResendVerification(emailToVerify: string) {
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: emailToVerify,
      });

      if (error) {
        toast.error(
          error.message || "Couldn't send the verification email. Try again.",
        );
        return;
      }

      toast.success(`Verification email sent to ${emailToVerify}.`);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't send the verification email. Try again.",
      );
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

  return (
    <Card className="w-full sm:max-w-md shadow-lg border-border/40">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          Welcome back
        </CardTitle>
        <CardDescription>
          Sign in to your account with email or continue with Google
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Google OAuth Button */}
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
          <span>Continue with Google</span>
        </Button>

        <FieldSeparator>or continue with email</FieldSeparator>

        {/* Email & Password Form */}
        <form id="login-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="space-y-4">
            {/* Email Field */}
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="login-email">Email Address</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <MailIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="login-email"
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
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="login-password">Password</FieldLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors underline-offset-4 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <LockIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      {...field}
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="current-password"
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

            {/* Remember Me Option */}
            <Controller
              name="rememberMe"
              control={form.control}
              render={({ field }) => (
                <Field
                  orientation="horizontal"
                  className="items-center gap-2 pt-1"
                >
                  <Checkbox
                    id="rememberMe"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(Boolean(checked))
                    }
                    disabled={isLoading || isGoogleLoading}
                  />
                  <FieldLabel
                    htmlFor="rememberMe"
                    className="cursor-pointer text-xs font-normal text-muted-foreground select-none"
                  >
                    Remember me for 30 days
                    <span className="text-muted-foreground/60 ml-1">(otherwise 7 days with auto-renewal)</span>
                  </FieldLabel>
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button
          type="submit"
          form="login-form"
          className="w-full font-medium"
          disabled={isLoading || isGoogleLoading}
        >
          {isLoading && <Spinner className="size-4 mr-2" />}
          <span>{isLoading ? "Signing in..." : "Sign in"}</span>
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Create account
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
};

export default LoginFormContent;
