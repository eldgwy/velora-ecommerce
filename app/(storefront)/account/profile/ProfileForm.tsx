"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  CalendarDaysIcon,
  MailIcon,
  PhoneIcon,
  UserRoundIcon,
} from "lucide-react";

import { updateProfile } from "@/shared/lib/actions/profile";
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
import LanguageToggle from "@/shared/components/LanguageToggle";
import { profileSchema, type ProfileFormValues } from "@/shared/types/profile";

interface ProfileFormProps {
  /** Sign-in email — read-only here (identity flows live in Settings). */
  email: string;
  profile: {
    firstName: string;
    middleName: string;
    lastName: string;
    phone: string;
    birthday: string;
    preferredLanguage: "en" | "ar";
  };
}

const ProfileForm = ({ email, profile }: ProfileFormProps) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: profile,
  });

  async function onSubmit(data: ProfileFormValues) {
    setIsLoading(true);
    try {
      const result = await updateProfile(data);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Profile updated.");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while saving your profile.";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl border border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Personal information</CardTitle>
        <CardDescription>
          Your name, contact details and preferences (SRS FR-02.01).
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          id="profile-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
          noValidate
        >
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {/* First name */}
            <Controller
              name="firstName"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="profile-first-name">
                    <UserRoundIcon className="size-4 text-muted-foreground" />
                    First name
                  </FieldLabel>
                  <Input
                    id="profile-first-name"
                    {...field}
                    autoComplete="given-name"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Middle name (optional) */}
            <Controller
              name="middleName"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="profile-middle-name">
                    Middle name
                  </FieldLabel>
                  <Input
                    id="profile-middle-name"
                    {...field}
                    value={field.value ?? ""}
                    autoComplete="additional-name"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Last name */}
            <Controller
              name="lastName"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="profile-last-name">Last name</FieldLabel>
                  <Input
                    id="profile-last-name"
                    {...field}
                    autoComplete="family-name"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Email — immutable in this surface */}
            <Field>
              <FieldLabel htmlFor="profile-email">
                <MailIcon className="size-4 text-muted-foreground" />
                Email
              </FieldLabel>
              <Input
                id="profile-email"
                value={email}
                disabled
                autoComplete="email"
                aria-describedby="profile-email-hint"
              />
              <FieldDescription id="profile-email-hint">
                Your sign-in email. Verification &amp; reset flows live in{" "}
                <Link
                   href="/account/settings"
                  className="font-medium text-velora-emerald underline-offset-4 hover:underline"
                >
                  Settings
                </Link>
                .
              </FieldDescription>
            </Field>

            {/* Phone — E.164 */}
            <Controller
              name="phone"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="profile-phone">
                    <PhoneIcon className="size-4 text-muted-foreground" />
                    Phone
                  </FieldLabel>
                  <Input
                    id="profile-phone"
                    {...field}
                    value={field.value ?? ""}
                    type="tel"
                    inputMode="tel"
                    placeholder="+15551234567"
                    autoComplete="tel-international"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    International format (E.164), starting with +.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Birthday */}
            <Controller
              name="birthday"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="profile-birthday">
                    <CalendarDaysIcon className="size-4 text-muted-foreground" />
                    Birthday
                  </FieldLabel>
                  <Input
                    id="profile-birthday"
                    {...field}
                    value={field.value ?? ""}
                    type="date"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Preferred language */}
            <Controller
              name="preferredLanguage"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  className="sm:col-span-2"
                >
                  <FieldLabel>Preferred language</FieldLabel>
                  <LanguageToggle
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isLoading}
                  />
                  <FieldDescription>
                    Used for emails and localized content (en / ar).
                  </FieldDescription>
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
              form="profile-form"
              disabled={isLoading}
              className="min-w-36"
            >
              {isLoading && <Spinner className="size-4" />}
              {isLoading ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default ProfileForm;
