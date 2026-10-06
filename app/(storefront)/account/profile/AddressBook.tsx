"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";

import {
  createAddress,
  deleteAddress,
  setDefaultAddress,
  updateAddress,
} from "@/shared/lib/actions/address";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { Switch } from "@/shared/components/ui/switch";
import type { AddressRow } from "@/services/address.service";
import { addressSchema, type AddressFormValues } from "@/shared/types/address";

interface AddressBookProps {
  addresses: AddressRow[];
}

const EMPTY_FORM: AddressFormValues = {
  label: "",
  addressLine1: "",
  addressLine2: "",
  addressLine3: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  isDefault: false,
};

/** Render an address as display lines (street lines → locality → country). */
function toDisplayLines(address: AddressRow): string[] {
  const street = [
    address.addressLine1,
    address.addressLine2,
    address.addressLine3,
  ].filter((line): line is string => Boolean(line));

  const locality = [address.city, address.state, address.postalCode].filter(
    Boolean,
  );

  return [...street, [...locality, address.country].join(", ")];
}

const AddressBook = ({ addresses }: AddressBookProps) => {
  const router = useRouter();

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AddressRow | null>(null);
  const [deleting, setDeleting] = React.useState<AddressRow | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: EMPTY_FORM,
  });

  function openCreate() {
    setEditing(null);
    form.reset(EMPTY_FORM);
    setIsFormOpen(true);
  }

  function openEdit(address: AddressRow) {
    setEditing(address);
    form.reset({
      label: address.label,
      addressLine1: address.addressLine1 ?? "",
      addressLine2: address.addressLine2 ?? "",
      addressLine3: address.addressLine3 ?? "",
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      isDefault: address.isDefault,
    });
    setIsFormOpen(true);
  }

  /** Create the address, or update the one being edited. */
  async function handleSubmitAddress(data: AddressFormValues) {
    setIsSubmitting(true);
    try {
      const result = editing
        ? await updateAddress(editing.id, data)
        : await createAddress(data);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(editing ? "Address updated." : "Address added.");
      setIsFormOpen(false);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while saving the address.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Promote an address to the single default (FR-02.02 transaction). */
  async function handleSetDefault(address: AddressRow) {
    setPendingId(address.id);
    try {
      const result = await setDefaultAddress(address.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(`"${address.label}" is now your default address.`);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      toast.error(message);
    } finally {
      setPendingId(null);
    }
  }

  /** Delete after confirmation — order history keeps its own snapshots. */
  async function handleDelete() {
    if (!deleting) return;

    setIsSubmitting(true);
    try {
      const result = await deleteAddress(deleting.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Address deleted.");
      setDeleting(null);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while deleting the address.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Card className="rounded-2xl border border-border/60">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle className="text-lg">Address book</CardTitle>
            <CardDescription>
              Saved delivery addresses (SRS FR-02.02). Deleting an address never
              affects addresses on past orders.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openCreate}
            className="shrink-0"
          >
            <PlusIcon className="size-4" />
            Add address
          </Button>
        </CardHeader>

        <CardContent>
          {addresses.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-velora-emerald/10 text-velora-emerald">
                <MapPinIcon className="size-5" />
              </span>
              <p className="font-medium text-foreground">No saved addresses</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add your first address to speed through checkout.
              </p>
              <Button type="button" size="sm" onClick={openCreate}>
                <PlusIcon className="size-4" />
                Add address
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {addresses.map((address) => {
                const isPending = pendingId === address.id;

                return (
                  <li
                    key={address.id}
                    className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-velora-emerald/10 text-velora-emerald">
                        <MapPinIcon className="size-4" />
                      </span>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-foreground">
                            {address.label}
                          </p>
                          {address.isDefault && (
                            <Badge
                              variant="secondary"
                              className="gap-1 bg-velora-emerald/10 text-velora-emerald"
                            >
                              <StarIcon className="size-3" />
                              Default
                            </Badge>
                          )}
                        </div>

                        <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                          {toDisplayLines(address).map((line) => (
                            <p key={line} className="truncate">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(address)}
                      >
                        <PencilIcon className="size-3.5" />
                        Edit
                      </Button>

                      {!address.isDefault && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleSetDefault(address)}
                        >
                          {isPending ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <StarIcon className="size-3.5" />
                          )}
                          Set default
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleting(address)}
                      >
                        <Trash2Icon className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ========== Create / edit dialog ========== */}
      <Dialog open={isFormOpen} onOpenChange={(open) => setIsFormOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit address" : "Add address"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this address. Marking it default atomically clears the flag on your other addresses."
                : "Save a delivery address for a faster checkout."}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit(handleSubmitAddress)}
            className="flex flex-col gap-4"
            noValidate
          >
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {/* Label */}
              <Controller
                name="label"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    className="sm:col-span-2"
                  >
                    <FieldLabel htmlFor="address-label">Label</FieldLabel>
                    <Input
                      id="address-label"
                      {...field}
                      placeholder="Home, Office, …"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Country / City */}
              <Controller
                name="country"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-country">Country</FieldLabel>
                    <Input
                      id="address-country"
                      {...field}
                      autoComplete="country-name"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      placeholder="US, EG, GBR…"
                    />
                    <FieldDescription>
                      2-3 letter country code (ISO 3166-1).
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="city"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-city">City</FieldLabel>
                    <Input
                      id="address-city"
                      {...field}
                      autoComplete="address-level2"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* State / postal code */}
              <Controller
                name="state"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-state">
                      State / region
                    </FieldLabel>
                    <Input
                      id="address-state"
                      {...field}
                      autoComplete="address-level1"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="postalCode"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-postal-code">
                      Postal code
                    </FieldLabel>
                    <Input
                      id="address-postal-code"
                      {...field}
                      autoComplete="postal-code"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>
                      Alphanumeric, 3-12 characters (e.g. 10001, SW1A 1AA).
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Street address lines */}
              {(["addressLine1", "addressLine2", "addressLine3"] as const).map(
                (name, index) => (
                  <Controller
                    key={name}
                    name={name}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field
                        data-invalid={fieldState.invalid}
                        className={index === 0 ? "sm:col-span-2" : undefined}
                      >
                        <FieldLabel htmlFor={`address-line-${index + 1}`}>
                          Address line {index + 1}
                          {index === 0 ? "" : " (optional)"}
                        </FieldLabel>
                        <Input
                          id={`address-line-${index + 1}`}
                          {...field}
                          value={field.value ?? ""}
                          autoComplete={
                            index === 0
                              ? "address-line1"
                              : `address-line${index + 1}`
                          }
                          disabled={isSubmitting}
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                ),
              )}

              {/* Default address toggle */}
              <Controller
                name="isDefault"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    className="sm:col-span-2"
                  >
                    <FieldLabel
                      htmlFor="address-is-default"
                      className="w-full items-center justify-between rounded-lg border border-border/60 px-3 py-2.5"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span>Set as default address</span>
                        <FieldDescription>
                          Used automatically at checkout.
                        </FieldDescription>
                      </span>
                      <Switch
                        id="address-is-default"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isSubmitting}
                      />
                    </FieldLabel>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            </FieldGroup>

            <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsFormOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner className="size-4" />}
                {editing ? "Save changes" : "Add address"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========== Delete confirmation ========== */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete address?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `"${deleting.label}" will be removed from your address book. Orders already placed keep their own copy of it.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              {isSubmitting && <Spinner className="size-4" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AddressBook;
