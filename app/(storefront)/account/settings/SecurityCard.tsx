"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { KeyRoundIcon } from "lucide-react";

import { authClient } from "@/shared/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from "@/shared/types/auth";

/**
 * Change-password form (FR-01.05 surface). `revokeOtherSessions: true`
 * signs the account out everywhere else once the password rotates.
 */
export default function SecurityCard() {
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: ChangePasswordFormValues) {
    setIsLoading(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        revokeOtherSessions: true,
      });

      if (error) {
        toast.error(
          error.message || "Couldn't update your password. Please try again.",
        );
        return;
      }

      toast.success("Password updated. Other sessions were signed out.");
      form.reset();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while changing your password.";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl border border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          Security
        </CardTitle>
        <CardDescription>
          Changing your password signs you out of every other device.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          id="change-password-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
          noValidate
        >
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Controller
              name="currentPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="current-password">
                    Current password
                  </FieldLabel>
                  <Input
                    id="current-password"
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              name="newPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="new-password">New password</FieldLabel>
                  <Input
                    id="new-password"
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    8+ chars with upper, lower, number &amp; symbol.
                  </FieldDescription>
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
                  <FieldLabel htmlFor="confirm-password">
                    Confirm new password
                  </FieldLabel>
                  <Input
                    id="confirm-password"
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>

          <div className="flex justify-end border-t border-border/60 pt-4">
            <Button
              type="submit"
              form="change-password-form"
              disabled={isLoading}
              className="min-w-44"
            >
              {isLoading && <Spinner className="size-4" />}
              {isLoading ? "Updating..." : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
