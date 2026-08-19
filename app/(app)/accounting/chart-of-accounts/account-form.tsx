"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCOUNT_TYPES,
  accountSchema,
  type AccountFormValues,
  type AccountInput,
} from "@/features/accounting/chart-of-accounts/schemas";
import { AccountAttachmentField } from "@/components/accounting/account-attachment-field";
import { amountValue } from "@/lib/forms/amount";

const typeLabels: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  asset: "Asset",
  liability: "Liability",
  income: "Income",
  expense: "Expense",
  equity: "Equity",
};

export interface ParentOption {
  id: string;
  account_code: string;
  account_name: string;
  account_type: (typeof ACCOUNT_TYPES)[number];
}

export interface CurrencyOption {
  id: string;
  code: string;
}

export interface CountryOption {
  code: string;
  name: string;
}

export function AccountForm({
  defaultValues,
  parentOptions,
  currencies,
  countries,
  onSubmit,
  submitLabel,
  accountId,
  linkedProperty = false,
}: {
  defaultValues: AccountInput;
  parentOptions: ParentOption[];
  currencies: CurrencyOption[];
  countries: CountryOption[];
  onSubmit: (values: AccountInput) => Promise<{ error?: string } | undefined>;
  submitLabel: string;
  /** Present when editing an existing account — enables the document uploads. */
  accountId?: string;
  /** True when the account already has a linked property in the Assets module. */
  linkedProperty?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<AccountFormValues, unknown, AccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues,
  });

  const isGroup = useWatch({ control: form.control, name: "isGroup" });
  const accountType = useWatch({ control: form.control, name: "accountType" });
  const selectedParentId = useWatch({ control: form.control, name: "parentId" });
  const scRate = useWatch({ control: form.control, name: "serviceChargesRate" });
  const scArea = useWatch({ control: form.control, name: "areaSqft" });
  const propertyCountry = useWatch({ control: form.control, name: "country" });
  const serviceChargesAmount = (Number(scRate) || 0) * (Number(scArea) || 0);
  const selectedParent = parentOptions.find((p) => p.id === selectedParentId);
  const lockAccountType = Boolean(selectedParent);

  // Accounts under the "PROPERTIES" group are managed as properties straight from
  // Chart of Accounts: the full property field set is surfaced and the account is
  // registered in the Assets module. The "This is a rental property" checkbox is
  // editable and only controls whether the property is offered in leases.
  // Matches the "PROPERTIES" group itself and any group nested under it — the
  // auto-created country sub-groups are named "DUBAI PROPERTIES", "PK PROPERTIES",
  // etc., so a name containing "PROPERTIES" is treated as a property parent. This
  // keeps the property fields + Rental toggle available for nested property
  // accounts (matching the server's ancestor-walking check).
  const parentName = (selectedParent?.account_name ?? "").trim().toUpperCase();
  const isPropertiesParent = parentName.includes("PROPERTIES");

  // The Details section (party info) is only relevant for Tenant / Customers /
  // Suppliers accounts, so it shows only under those groups.
  const DETAILS_PARENTS = new Set(["TENANT", "TENANTS", "CUSTOMER", "CUSTOMERS", "SUPPLIER", "SUPPLIERS"]);
  const isDetailsParent = DETAILS_PARENTS.has(parentName);

  const canBeRentalProperty = !isGroup && accountType === "asset";
  const showPropertyFields = canBeRentalProperty && (isPropertiesParent || linkedProperty);

  // Clear the rental flag when the account can no longer be a property (switched
  // to a group or a non-asset type).
  useEffect(() => {
    if (!canBeRentalProperty) form.setValue("isRentalProperty", false);
  }, [canBeRentalProperty, form]);

  function handleParentChange(value: string, onChange: (value: string) => void) {
    const parentId = value === "none" ? "" : value;
    onChange(parentId);
    const parent = parentOptions.find((p) => p.id === parentId);
    if (parent) form.setValue("accountType", parent.account_type);
  }

  function handleSubmit(values: AccountInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result?.error) setFormError(result.error);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormSection title="Account information">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Cash in Hand" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent account</FormLabel>
                  <Select
                    onValueChange={(value) => handleParentChange(value, field.onChange)}
                    defaultValue={field.value || "none"}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No parent (root)</SelectItem>
                      {parentOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        <FormSection title="Classification">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="accountType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={lockAccountType}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {typeLabels[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {lockAccountType && (
                    <FormDescription>Inherited from the parent account.</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currencyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Restrict to currency</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === "base" ? "" : value)}
                    defaultValue={field.value || "base"}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="base">Company base currency</SelectItem>
                      {currencies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>Only this currency can post to the account.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="isGroup"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-2.5 rounded-lg border p-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Group / header account</FormLabel>
                  <FormDescription>
                    Groups organize the tree and can have child accounts, but
                    can&apos;t be posted to directly.
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
          {isGroup && (
            <FormField
              control={form.control}
              name="isTenantGroup"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2.5 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Tenant group</FormLabel>
                    <FormDescription>
                      Accounts under this group are the tenant master that leases pick tenants from.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          )}
          {showPropertyFields && (
            <FormField
              control={form.control}
              name="isRentalProperty"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2.5 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>This is a rental property</FormLabel>
                    <FormDescription>
                      Tick when this property is rented out — only rental properties are offered in
                      leases, filtered by country (UAE → UAE &amp; HH leases, Pakistan → PK leases).
                      The property is registered in Assets either way.
                    </FormDescription>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
          )}
        </FormSection>

        {!isGroup && isDetailsParent && (
          <FormSection title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="idNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID number</FormLabel>
                    <FormControl>
                      <Input placeholder="Passport / Emirates ID / CNIC" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact person</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not set</SelectItem>
                        {countries.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Used to filter tenants by country in leases.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {accountId ? (
              <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
                <AccountAttachmentField accountId={accountId} slot="id" label="ID attachment" />
                <AccountAttachmentField accountId={accountId} slot="police" label="Police verification" />
                <AccountAttachmentField accountId={accountId} slot="agreement" label="Rent agreement" />
              </div>
            ) : (
              <p className="border-t pt-4 text-xs text-muted-foreground">
                Save the account first to attach ID, police verification and rent agreement documents.
              </p>
            )}
          </FormSection>
        )}

        {showPropertyFields && (
          <FormSection title="Property details">
            <p className="text-xs text-muted-foreground">
              These describe the linked property in the Assets module. Set the country so a
              rental property appears in that country&apos;s leases.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not set</SelectItem>
                        {countries.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Which country&apos;s leases this property appears in.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="propertyType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property type</FormLabel>
                    <FormControl>
                      <Input placeholder="Apartment / Villa / Office" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="propertyStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="sold">Sold</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Owner</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="officialOwner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Official owner</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="areaSqft"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="areaUnit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <FormControl>
                        <Input placeholder="sqft / sqm / marla" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="purchaseValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase value</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currentValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current value</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="titleDeedValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{propertyCountry === "PK" ? "Official value" : "Title deed value"}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {propertyCountry === "AE" && (
                <>
                  <FormField
                    control={form.control}
                    name="serviceChargesRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service charges rate</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                        </FormControl>
                        <FormDescription>Per unit of area.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormItem>
                    <FormLabel>Service charges value</FormLabel>
                    <FormControl>
                      <Input type="number" readOnly value={serviceChargesAmount || ""} className="bg-muted/50" tabIndex={-1} />
                    </FormControl>
                    <FormDescription>Rate × area, calculated automatically.</FormDescription>
                  </FormItem>
                </>
              )}
              {propertyCountry === "PK" && (
                <FormField
                  control={form.control}
                  name="propertyTax"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Property tax</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="otherCharges"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Other charges</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="estimatedRent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated rent</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} value={amountValue(field.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="propertyNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>
        )}

        <FormSection title="Balances &amp; reporting">
          <FormField
            control={form.control}
            name="openingBalance"
            render={({ field }) => (
              <FormItem className="sm:max-w-xs">
                <FormLabel>Opening balance</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={isGroup}
                    {...field}
                    value={amountValue(field.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="isCash"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2.5 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Cash account</FormLabel>
                    <FormDescription>Included in the Cash Book report.</FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isBank"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2.5 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Bank account</FormLabel>
                    <FormDescription>Included in the Bank Book report.</FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        {formError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
