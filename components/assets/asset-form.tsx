"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assetSchema, type AssetFormValues, type AssetInput } from "@/features/assets/schemas";
import { createCountry } from "@/features/assets/countries/actions";
import { amountValue } from "@/lib/forms/amount";
import { AREA_UNITS, convertedArea } from "@/lib/assets/area-units";

// A newly-picked country pre-selects its currency (if the company has it).
const COUNTRY_CURRENCY: Record<string, string> = { PK: "PKR", AE: "AED" };

export interface CurrencyOption {
  id: string;
  code: string;
  symbol?: string;
}

export interface CostCenterOption {
  id: string;
  code: string;
  name: string;
}

export interface CountryOption {
  code: string;
  name: string;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="sm:col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

export function AssetForm({
  defaultValues,
  currencies,
  costCenters,
  countries,
  canAddCountry,
  onSubmit,
  submitLabel,
}: {
  defaultValues: AssetFormValues;
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  countries: CountryOption[];
  canAddCountry: boolean;
  onSubmit: (values: AssetInput) => Promise<{ error?: string } | undefined>;
  submitLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [countryList, setCountryList] = useState<CountryOption[]>(countries);
  const [addCountryOpen, setAddCountryOpen] = useState(false);

  const form = useForm<AssetFormValues, unknown, AssetInput>({
    resolver: zodResolver(assetSchema),
    defaultValues,
  });

  const areaUnit = useWatch({ control: form.control, name: "areaUnit" });
  const areaSqft = useWatch({ control: form.control, name: "areaSqft" });
  const areaConverted = convertedArea(Number(areaSqft) || 0, areaUnit || null);

  // Single "Cost center" dropdown backed by two fields: costCenterMode
  // ('new' | 'none' | 'existing') and, for 'existing', groupCostCenterId.
  const costCenterMode = useWatch({ control: form.control, name: "costCenterMode" });
  const groupCostCenterId = useWatch({ control: form.control, name: "groupCostCenterId" });
  const costCenterSelectValue = costCenterMode === "existing" ? groupCostCenterId || "new" : costCenterMode || "new";
  function handleCostCenterChange(value: string) {
    if (value === "new" || value === "none") {
      form.setValue("costCenterMode", value, { shouldValidate: true });
      form.setValue("groupCostCenterId", "", { shouldValidate: true });
    } else {
      form.setValue("costCenterMode", "existing", { shouldValidate: true });
      form.setValue("groupCostCenterId", value, { shouldValidate: true });
    }
  }

  function handleSubmit(values: AssetInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result?.error) setFormError(result.error);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="grid max-w-3xl gap-4 sm:grid-cols-2">
        {/* PROPERTY INFORMATION ------------------------------------------------ */}
        <SectionHeading>Property information</SectionHeading>
        <FormField
          control={form.control}
          name="assetName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Asset name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
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
                <Input placeholder="e.g. Apartment, Villa, Office" {...field} />
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
              <div className="flex gap-2">
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    const currency = currencies.find((c) => c.code === COUNTRY_CURRENCY[v]);
                    if (currency) form.setValue("currencyId", currency.id, { shouldValidate: true });
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {countryList.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canAddCountry && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Add country"
                    onClick={() => setAddCountryOpen(true)}
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                )}
              </div>
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
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} />
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
                <Input placeholder="Legal / registered owner" {...field} />
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
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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
          name="purchaseDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Purchase date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* PROPERTY SIZE ------------------------------------------------------- */}
        <SectionHeading>Property size</SectionHeading>
        <FormField
          control={form.control}
          name="areaSqft"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Area</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              {areaConverted && <FormDescription>{areaConverted}</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="areaUnit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Area unit</FormLabel>
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
                  {AREA_UNITS.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="area"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Area note (optional)</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Plot 12, Block C" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* PROPERTY VALUES ----------------------------------------------------- */}
        <SectionHeading>Property values</SectionHeading>
        <FormField
          control={form.control}
          name="currencyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Currency</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                value={field.value || "none"}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="purchaseValue"
          render={({ field }) => (
            <FormItem className="sm:col-span-2 rounded-lg border-2 border-ledger/40 bg-ledger/10 px-4 py-3">
              <FormLabel className="text-sm font-semibold uppercase tracking-wide text-ledger">
                Purchase value
              </FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
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
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormDescription>Changing this adds a Value History record.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="valueEffectiveDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Value effective date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormDescription>Date the new current value takes effect.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="valueRemarks"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Value change remarks (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Reason for the value change" {...field} />
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
              <FormLabel>Title deed value</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="serviceChargesRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Service charges</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="otherCharges"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Other charges</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
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
                <Input type="number" step="0.01" min="0" {...field} value={amountValue(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* OTHER --------------------------------------------------------------- */}
        <SectionHeading>Other</SectionHeading>
        <FormItem>
          <FormLabel>Cost center</FormLabel>
          <Select value={costCenterSelectValue} onValueChange={handleCostCenterChange}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="new">New — create a dedicated cost center</SelectItem>
              <SelectItem value="none">None — don&apos;t link a cost center</SelectItem>
              {costCenters.map((cc) => (
                <SelectItem key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>
            <strong>New</strong> creates a dedicated cost center for this asset. <strong>None</strong> links
            nothing. Or pick an existing cost center to link the asset to it.
          </FormDescription>
        </FormItem>
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        <Button type="submit" disabled={isPending} className="sm:col-span-2 sm:w-fit">
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </form>

      {canAddCountry && (
        <AddCountryDialog
          open={addCountryOpen}
          onOpenChange={setAddCountryOpen}
          onAdded={(c) => {
            setCountryList((prev) =>
              prev.some((x) => x.code === c.code) ? prev : [...prev, c].sort((a, b) => a.name.localeCompare(b.name)),
            );
            form.setValue("country", c.code, { shouldValidate: true });
            const currency = currencies.find((x) => x.code === COUNTRY_CURRENCY[c.code]);
            if (currency) form.setValue("currencyId", currency.id, { shouldValidate: true });
          }}
        />
      )}
    </Form>
  );
}

function AddCountryDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (country: CountryOption) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createCountry({ name, code: code || undefined });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.success) {
        toast.success("Country added");
        onAdded({ code: result.code!, name: result.name! });
        setName("");
        setCode("");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add country</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-country-name">Country name</Label>
            <Input
              id="new-country-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Saudi Arabia"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-country-code">Code (optional)</Label>
            <Input
              id="new-country-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Auto-generated if left blank (e.g. SA)"
              maxLength={6}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending || name.trim().length < 2}>
            {isPending ? "Adding…" : "Add country"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
