"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangleIcon, CheckCircle2Icon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox, type AccountOption } from "@/components/vouchers/account-combobox";
import { CurrencySelect, type CurrencyOption } from "@/components/vouchers/currency-select";
import { DateInput } from "@/components/vouchers/date-input";
import { MonthInput } from "@/components/vouchers/month-input";
import { TABLE_TOTAL_ROW } from "@/components/ui/table";
import { amountValue, blankAmount } from "@/lib/forms/amount";
import { formatDate, formatMoney } from "@/lib/format";
import {
  monthFromLabel,
  monthStart,
  rentMonthLabel,
  rentMonthOn,
  rentMonthsFor,
  rentMonthsOf,
} from "@/lib/rental/rent-months";
import { cn } from "@/lib/utils";
import {
  createRentStatement,
  rememberUnitAliases,
  updateRentStatement,
} from "@/features/rental/rent-statements/actions";
import { parseStatementSheet } from "@/lib/rental/statement-sheet";
import { readWorkbook, type WorkbookSheet } from "@/lib/rental/xlsx";
import {
  MANAGEMENT_RATE,
  rentStatementSchema,
  type RentStatementFormValues,
  type RentStatementInput,
} from "@/features/rental/rent-statements/schemas";

export interface UnitOption {
  id: string;
  name: string;
}

/** What the agent's sheet has called a unit before, and which unit that is. */
export interface UnitAlias {
  alias: string;
  costCenterId: string;
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const n = (v: unknown) => Number(v) || 0;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(lineType: "short_term" | "long_term", rentMonth: string) {
  return {
    lineType,
    costCenterId: "",
    periodFrom: "",
    periodTo: "",
    rentMonth,
    months: 1,
    rentAmount: blankAmount,
    managementAmount: blankAmount,
    dewa: blankAmount,
    internet: blankAmount,
    accessCard: blankAmount,
    wifi: blankAmount,
    other: blankAmount,
    remarks: "",
  };
}

/**
 * The letting agent's monthly statement, entered as the document it is.
 *
 * One sheet, both kinds of unit: the short-term lettings the agent takes 10%
 * on, and the long-term ones at 5%. They used to need two different vouchers,
 * which meant splitting one piece of paper in half and then adding it back up
 * by hand to see whether it agreed with the agent. Agreeing with the agent is
 * the entire point of entering it, so the sheet goes in as one voucher with one
 * total.
 *
 * Three things this screen is careful about.
 *
 * MANAGEMENT IS A FIGURE, NOT A FORMULA. The rate fills it in as a convenience
 * and nothing more: the agent rounds 716.70 to 717, and a form that insisted on
 * its own arithmetic would disagree with the statement by thirty fils. The
 * implied rate is shown beside it so a figure that is NOT the usual 5% or 10%
 * is visible rather than silently accepted.
 *
 * THE RENT MONTH IS SUGGESTED, NEVER ASSUMED. From and To give the months, by
 * the calendar and not by dividing days. Where a period is not a whole number
 * of months — 1 Aug to 21 Sep is one month and twenty-one days — the line says
 * so and waits to be told, because a month's rent quietly landing in the wrong
 * month is the one error nobody would find.
 *
 * THE SHEET'S OWN TOTAL IS CHECKED. Type the grand total off the paper and the
 * footer says whether the lines agree with it. A mistyped amount then shows up
 * as a total that does not match, instead of a number that merely looks right.
 */
export function RentStatementForm({
  accounts,
  currencies,
  units,
  aliases,
  defaultAgentAccountId,
  defaultCurrencyId,
  billedUpTo = {},
  letUntil = {},
  statementId,
  initial,
}: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  units: UnitOption[];
  aliases: UnitAlias[];
  defaultAgentAccountId?: string | null;
  /** The agent's own currency — the statement is written in it. */
  defaultCurrencyId?: string | null;
  /** The last rent month already billed for each unit, by cost centre id. */
  billedUpTo?: Record<string, string>;
  /** How far a lease runs with nothing left to bill, by cost centre id. */
  letUntil?: Record<string, string>;
  /** Set when editing: the draft being rewritten, which keeps its id. */
  statementId?: string;
  initial?: RentStatementFormValues;
}) {
  // Each currency's conversion to base. The company's base is SAR and these
  // statements are in AED, so a rate of 1 would put the ledger out by the
  // whole difference — it follows the currency rather than being assumed.
  const rateById = useMemo(
    () => new Map(currencies.map((c) => [c.id, (c as { rate?: number }).rate ?? 1])),
    [currencies],
  );
  const openingCurrency =
    (defaultCurrencyId && currencies.some((c) => c.id === defaultCurrencyId)
      ? defaultCurrencyId
      : currencies[0]?.id) ?? "";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  // Why a save was refused. Without this the form simply did nothing when a
  // row was incomplete — the grid has no room for a message under each cell,
  // so every reason is gathered here instead.
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);

  const form = useForm<RentStatementFormValues>({
    resolver: zodResolver(rentStatementSchema),
    defaultValues: initial ?? {
      statementDate: today(),
      statementMonth: monthStart(today()),
      agentAccountId: defaultAgentAccountId ?? "",
      currencyId: openingCurrency,
      exchangeRate: rateById.get(openingCurrency) ?? 1,
      narration: "",
      lines: [emptyLine("short_term", monthStart(today()))],
      sheetTotalNet: "",
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "lines" });
  // What the sheet called each row's unit, kept beside the lines so an
  // unmatched row can say which name it is waiting to be told about — and so
  // the mapping can be remembered once it has been.
  const [sheetUnits, setSheetUnits] = useState<string[]>([]);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  // The agent sends one workbook with a tab per month. Which tab is meant is
  // his decision to state, not ours to guess — reading the first one silently
  // imported August however many times September was asked for.
  const [workbook, setWorkbook] = useState<WorkbookSheet[]>([]);
  const [importedSheet, setImportedSheet] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // alias -> unit, and the units' own names, both normalised: "218 X-17 IC"
  // should find "218 X-17 IC" without anybody being asked.
  const unitByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of units) map.set(normalise(u.name), u.id);
    for (const a of aliases) map.set(normalise(a.alias), a.costCenterId);
    return map;
  }, [units, aliases]);

  async function onFile(file: File) {
    setImportNotes([]);
    setWorkbook([]);
    setImportedSheet("");
    try {
      const sheets = await readWorkbook(file);
      if (sheets.length === 1) {
        importSheet(sheets[0]);
        return;
      }
      // Several tabs: show them and wait. Nothing is read until one is picked.
      setWorkbook(sheets);
      setImportNotes([
        `This workbook has ${sheets.length} sheets — pick the one to read: ${sheets.map((x) => x.name).join(", ")}.`,
      ]);
    } catch (error) {
      setImportNotes([
        `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  function importSheet(from: WorkbookSheet) {
    setImportNotes([]);
    try {
      const sheet = parseStatementSheet(from.grid);
      if (sheet.lines.length === 0) {
        setImportNotes(sheet.warnings.length ? sheet.warnings : ["Nothing could be read from that file."]);
        return;
      }

      // The month this sheet is FOR, which is not the date on it: September's
      // statement was drawn up on 10 October. The tab the agent typed —
      // "SEP-26" — says which month he meant; the date is only a fallback.
      const dated = sheet.statementDate ?? today();
      const sheetMonth = monthFromLabel(from.name, Number(dated.slice(0, 4))) ?? monthStart(dated);

      const unmatched: string[] = [];
      const imported = sheet.lines.map((l) => {
        const unitId = unitByName.get(normalise(l.sheetUnit)) ?? "";
        if (!unitId) unmatched.push(l.sheetUnit);
        const period = l.periodFrom && l.periodTo ? rentMonthsFor(l.periodFrom, l.periodTo) : null;
        return {
          lineType: l.lineType,
          costCenterId: unitId,
          periodFrom: l.periodFrom,
          periodTo: l.periodTo,
          // The month the unit was LET, never earlier than the month the sheet
          // is for — a letting that began on the 31st belongs to the month
          // starting the next day, which is the month being billed.
          rentMonth: rentMonthOn(period?.firstMonth ?? sheetMonth, sheetMonth),
          months: period?.months ?? 1,
          rentAmount: l.rentAmount,
          managementAmount: l.managementAmount,
          dewa: l.dewa,
          internet: l.internet,
          accessCard: l.accessCard,
          wifi: l.wifi,
          other: l.other,
          remarks: "",
        };
      });

      replace(imported);
      setSheetUnits(sheet.lines.map((l) => l.sheetUnit));
      if (sheet.statementDate) form.setValue("statementDate", sheet.statementDate);
      form.setValue("statementMonth", sheetMonth);
      if (sheet.grandTotalNet != null) {
        form.setValue("sheetTotalNet", sheet.grandTotalNet as never);
      }

      const notes = [...sheet.warnings, ...sheet.lines.flatMap((l) => l.warnings.map((w) => `${l.sheetUnit}: ${w}`))];
      if (unmatched.length) {
        notes.unshift(
          `Pick the unit for: ${[...new Set(unmatched)].join(", ")} — it will be remembered next time.`,
        );
      }
      setImportNotes(notes);
      setImportedSheet(from.name);
      toast.success(`Read ${imported.length} ${imported.length === 1 ? "row" : "rows"} from “${from.name}”`);
    } catch (error) {
      setImportNotes([
        `That sheet could not be read: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const statementMonth = useWatch({ control: form.control, name: "statementMonth" });
  const sheetTotalNet = useWatch({ control: form.control, name: "sheetTotalNet" });

  const totals = useMemo(() => {
    const lines = watchedLines ?? [];
    const t = { rent: 0, management: 0, deductions: 0, net: 0, netRent: 0 };
    for (const l of lines) {
      const rent = n(l?.rentAmount);
      const mgmt = n(l?.managementAmount);
      const ded = n(l?.dewa) + n(l?.internet) + n(l?.accessCard) + n(l?.wifi) + n(l?.other);
      t.rent += rent;
      t.management += mgmt;
      t.deductions += ded;
      t.netRent += rent - mgmt;
      t.net += rent - mgmt - ded;
    }
    return t;
  }, [watchedLines]);

  const sheetTotal = sheetTotalNet === "" || sheetTotalNet == null ? null : Number(sheetTotalNet);
  const tallyDiff =
    sheetTotal == null ? null : Math.round((totals.net - sheetTotal) * 100) / 100;

  function onInvalid(errors: Record<string, unknown>) {
    const messages: string[] = [];
    const lineErrors = errors.lines as unknown;
    if (Array.isArray(lineErrors)) {
      lineErrors.forEach((row, i) => {
        if (!row) return;
        for (const issue of Object.values(row as Record<string, { message?: string }>)) {
          if (issue?.message) messages.push(`Line ${i + 1}: ${issue.message}`);
        }
      });
    }
    for (const key of ["statementDate", "statementMonth", "agentAccountId", "currencyId", "exchangeRate", "sheetTotalNet"]) {
      const issue = errors[key] as { message?: string } | undefined;
      if (issue?.message) messages.push(issue.message);
    }
    if (!Array.isArray(lineErrors)) {
      const issue = errors.lines as { message?: string } | undefined;
      if (issue?.message) messages.push(issue.message);
    }
    setSubmitErrors(messages.length ? messages : ["Something on the form is not filled in yet."]);
  }

  function onSubmit(values: RentStatementFormValues) {
    setFormError(null);
    setSubmitErrors([]);
    startTransition(async () => {
      const result = statementId
        ? await updateRentStatement(statementId, values as unknown as RentStatementInput)
        : await createRentStatement(values as unknown as RentStatementInput);
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      // Now that the units are chosen, remember what the sheet called them.
      const pairs = values.lines
        .map((l, i) => ({ alias: sheetUnits[i] ?? "", costCenterId: l.costCenterId }))
        .filter((p) => p.alias && p.costCenterId);
      if (pairs.length) await rememberUnitAliases(pairs);

      toast.success(statementId ? "Rent statement updated" : "Rent statement saved");
      router.push(`/rental/rent-statements/${result.id}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-5">
        {/* The sheet itself, read in. It never saves and never posts: it fills
            the form in, and everything below still has to be looked at and
            agreed to. A file that cannot be read says so rather than filling
            in half a form. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <UploadIcon /> Import the agent&apos;s sheet
          </Button>
          <p className="text-xs text-muted-foreground">
            Reads the .xlsx into the lines below. Nothing is saved until you say so.
          </p>
          {importedSheet && (
            <span className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Read from “{importedSheet}”
            </span>
          )}
          {workbook.length > 1 && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">Which sheet?</span>
              {workbook.map((s) => (
                <Button
                  key={s.name}
                  type="button"
                  size="sm"
                  variant={s.name === importedSheet ? "default" : "secondary"}
                  onClick={() => importSheet(s)}
                >
                  {s.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {submitErrors.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {submitErrors.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                {e}
              </li>
            ))}
          </ul>
        )}

        {importNotes.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {importNotes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-amber-800 dark:text-amber-400">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                {note}
              </li>
            ))}
          </ul>
        )}

        <FormSection title="Statement" description="The sheet's own heading — date, month and whose statement it is.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField
              control={form.control}
              name="statementDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Statement date</FormLabel>
                  <FormControl>
                    <DateInput type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="statementMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Month</FormLabel>
                  <FormControl>
                    <MonthInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="agentAccountId"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Agent</FormLabel>
                  <FormControl>
                    <AccountCombobox accounts={accounts} value={field.value} onValueChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currencyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <CurrencySelect
                      currencies={currencies}
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue("exchangeRate", rateById.get(v) ?? 1, { shouldValidate: true });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="exchangeRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency Conv.</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.000001" min="0" {...field} value={field.value as number} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="narration"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Narration</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        <FormSection
          title="Units"
          description="One row per row of the sheet. Short term is billed from here; long term is already invoiced from its lease and is carried for the total."
          actions={
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append(emptyLine("short_term", statementMonth))}
              >
                <PlusIcon /> Short term
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append(emptyLine("long_term", statementMonth))}
              >
                <PlusIcon /> Long term
              </Button>
            </div>
          }
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 [&>th]:px-2 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
                  <th className="w-28 text-left">Type</th>
                  <th className="min-w-[180px] text-left">Unit</th>
                  <th className="w-36 text-left">From</th>
                  <th className="w-36 text-left">To</th>
                  <th className="w-44 text-left">Rent month</th>
                  <th className="w-20 text-right">Months</th>
                  <th className="w-28 text-right">Rent</th>
                  <th className="w-32 text-right">Management</th>
                  <th className="w-24 text-right">DEWA</th>
                  <th className="w-24 text-right">Internet</th>
                  <th className="w-24 text-right">Access</th>
                  <th className="w-24 text-right">WiFi</th>
                  <th className="w-24 text-right">Other</th>
                  <th className="w-28 text-right">Net</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <LineRow
                    key={f.id}
                    index={i}
                    form={form}
                    units={units}
                    statementMonth={statementMonth}
                    sheetUnit={sheetUnits[i]}
                    billedUpTo={billedUpTo}
                    letUntil={letUntil}
                    onRemove={() => remove(i)}
                    canRemove={fields.length > 1}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className={cn(TABLE_TOTAL_ROW, "[&>td]:px-2 [&>td]:py-2")}>
                  <td colSpan={6} className="text-xs uppercase tracking-wide">
                    Total — {fields.length} {fields.length === 1 ? "line" : "lines"}
                  </td>
                  <td className="text-right font-mono tabular-nums">{formatMoney(totals.rent)}</td>
                  <td className="text-right font-mono tabular-nums">{formatMoney(totals.management)}</td>
                  <td colSpan={5} className="text-right font-mono tabular-nums">
                    {formatMoney(totals.deductions)} deducted
                  </td>
                  <td className="text-right font-mono tabular-nums">{formatMoney(totals.net)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </FormSection>

        <FormSection
          title="Does it agree with the sheet?"
          description="Type the grand total off the agent's paper. A line entered wrong shows up here as a total that does not match."
        >
          <div className="flex flex-wrap items-end gap-4">
            <FormField
              control={form.control}
              name="sheetTotalNet"
              render={({ field }) => (
                <FormItem className="w-48">
                  <FormLabel>Sheet&apos;s grand total (Net)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      placeholder="e.g. 42029"
                      className="text-right font-mono tabular-nums"
                      {...field}
                      value={amountValue(field.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="pb-1 text-sm">
              <p className="text-muted-foreground">
                Lines come to{" "}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {formatMoney(totals.net)}
                </span>
              </p>
              {tallyDiff !== null &&
                (tallyDiff === 0 ? (
                  <p className="mt-0.5 flex items-center gap-1.5 font-medium text-[#0ca30c]">
                    <CheckCircle2Icon className="size-4" /> Agrees with the sheet
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-1.5 font-medium text-destructive">
                    <AlertTriangleIcon className="size-4" />
                    Out by {formatMoney(Math.abs(tallyDiff))} — the lines are{" "}
                    {tallyDiff > 0 ? "higher" : "lower"} than the sheet
                  </p>
                ))}
            </div>
          </div>
        </FormSection>

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save statement"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/**
 * One row of the sheet.
 *
 * From and To fill in the rent month and the number of months, once, when they
 * are both set — and then leave them alone, because a row corrected by hand
 * must not be corrected back on the next keystroke.
 */
function LineRow({
  index,
  form,
  units,
  statementMonth,
  sheetUnit,
  billedUpTo,
  letUntil,
  onRemove,
  canRemove,
}: {
  index: number;
  form: ReturnType<typeof useForm<RentStatementFormValues>>;
  units: UnitOption[];
  statementMonth: string;
  /** What the imported sheet called this row's unit, when it came from one. */
  sheetUnit?: string;
  billedUpTo: Record<string, string>;
  letUntil: Record<string, string>;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const line = useWatch({ control: form.control, name: `lines.${index}` });
  const from = line?.periodFrom ?? "";
  const to = line?.periodTo ?? "";
  const lineType = (line?.lineType ?? "short_term") as "short_term" | "long_term";

  const period = useMemo(() => (from && to ? rentMonthsFor(from, to) : null), [from, to]);

  // Suggest the months and the rent month once the dates are both in: the
  // month the unit was let, never earlier than the month the sheet is for.
  const lastSuggested = useRef<string>("");
  useEffect(() => {
    if (!period || !from || !to) return;
    const key = `${from}|${to}|${statementMonth}`;
    if (lastSuggested.current === key) return;
    lastSuggested.current = key;
    form.setValue(`lines.${index}.rentMonth`, rentMonthOn(period.firstMonth, statementMonth), {
      shouldDirty: true,
    });
    form.setValue(`lines.${index}.months`, period.months, { shouldDirty: true });
  }, [period, from, to, statementMonth, form, index]);

  const months = Math.max(1, Number(line?.months) || 1);
  const rentMonth = (line?.rentMonth as string) || statementMonth;

  // Only worth saying on a row with no rent on it: a row that HAS rent is
  // about to be billed, and how far the unit was billed before is not news.
  const billedAnswer = useMemo(() => {
    const unitId = (line?.costCenterId as string) || "";
    const billed = unitId ? billedUpTo[unitId] : undefined;
    if (!unitId || n(line?.rentAmount) !== 0) return null;
    if (billed && billed >= rentMonth) {
      return { covered: true, text: `already billed to ${rentMonthLabel(billed)} — nothing due here` };
    }
    // A lease can cover a unit with nothing to bill: the rent was taken in
    // full before SSA opened, so the agent lists it month after month with
    // nothing against it. "Never billed" would be true and useless.
    const let_ = unitId ? letUntil[unitId] : undefined;
    if (let_ && let_ >= rentMonth) {
      return { covered: true, text: `let to ${formatDate(let_)} — no rent to bill here` };
    }
    return {
      covered: false,
      text: billed
        ? `last billed ${rentMonthLabel(billed)} — ${rentMonthLabel(rentMonth)} not stated yet`
        : "never billed — no rent stated for this unit",
    };
  }, [line?.costCenterId, line?.rentAmount, rentMonth, billedUpTo, letUntil]);
  const rent = n(line?.rentAmount);
  const mgmt = n(line?.managementAmount);
  const deductions = n(line?.dewa) + n(line?.internet) + n(line?.accessCard) + n(line?.wifi) + n(line?.other);
  const net = rent - mgmt - deductions;
  const impliedRate = rent > 0 ? mgmt / rent : null;
  const expectedRate = MANAGEMENT_RATE[lineType];
  // No management at all on a line that earned rent is the loudest version of
  // this, not the quietest: October's sheet left 214 ROSE's 300 out of the
  // management column and in DEWA, and a check that only looked at lines
  // WITH a fee said nothing about it.
  const rateLooksOff =
    impliedRate !== null && rent > 0 && Math.abs(impliedRate - expectedRate) > 0.005;

  const amountCell = (name: "dewa" | "internet" | "accessCard" | "wifi" | "other") => (
    <td className="px-2 py-1">
      <FormField
        control={form.control}
        name={`lines.${index}.${name}`}
        render={({ field }) => (
          <Input
            inputMode="decimal"
            className="h-8 text-right font-mono tabular-nums"
            {...field}
            value={amountValue(field.value)}
            disabled={lineType === "long_term"}
          />
        )}
      />
    </td>
  );

  return (
    <tr className="border-b [&>td]:align-top">
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.lineType`}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short_term">Short term</SelectItem>
                <SelectItem value="long_term">Long term</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {lineType === "long_term" && (
          // Said on the row itself, not only in the documentation: this unit is
          // invoiced monthly from its lease already, so the line is here to
          // make the total agree with the sheet and posts nothing of its own.
          <p className="mt-1 text-[0.7rem] leading-tight text-muted-foreground">
            already invoiced — total only
          </p>
        )}
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.costCenterId`}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className={cn("h-8 w-full", sheetUnit && !field.value && "border-amber-500")}>
                <SelectValue placeholder={sheetUnit ?? "Unit"} />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {sheetUnit && (
          <p className="mt-1 truncate text-[0.7rem] text-muted-foreground" title={sheetUnit}>
            sheet: {sheetUnit}
          </p>
        )}
        {/* A unit with no rent against it says nothing about why. SSA knows
            how far it is already billed, so the row can say whether this is
            rent already taken or rent the agent has not stated yet. */}
        {billedAnswer && (
          <p
            className={cn(
              "mt-1 flex items-start gap-1 text-[0.7rem] leading-tight",
              billedAnswer.covered ? "text-muted-foreground" : "text-amber-700 dark:text-amber-500",
            )}
          >
            {!billedAnswer.covered && <AlertTriangleIcon className="mt-px size-3 shrink-0" />}
            {billedAnswer.text}
          </p>
        )}
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.periodFrom`}
          render={({ field }) => <DateInput type="date" className="h-8" {...field} />}
        />
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.periodTo`}
          render={({ field }) => <DateInput type="date" className="h-8" {...field} />}
        />
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.rentMonth`}
          render={({ field }) => <MonthInput value={field.value} onChange={field.onChange} />}
        />
        {months > 1 && (
          <p className="mt-1 text-[0.7rem] leading-tight text-muted-foreground">
            {rentMonthsOf(rentMonth, months).map(rentMonthLabel).join(" + ")}
          </p>
        )}
        {period && rentMonth > period.firstMonth && (
          <p className="mt-1 text-[0.7rem] leading-tight text-muted-foreground">
            let in {rentMonthLabel(period.firstMonth)} — counted in {rentMonthLabel(rentMonth)}
          </p>
        )}
        {period?.isPartial && (
          <p className="mt-1 flex items-start gap-1 text-[0.7rem] leading-tight text-amber-700 dark:text-amber-500">
            <AlertTriangleIcon className="mt-px size-3 shrink-0" />
            {period.stretchDays > 0
              ? `${period.stretchDays} days longer than ${period.months} month${period.months === 1 ? "" : "s"} — check the months`
              : `${-period.stretchDays} days short of ${period.months} month${period.months === 1 ? "" : "s"} — check the months`}
          </p>
        )}
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.months`}
          render={({ field }) => (
            <Input
              inputMode="numeric"
              className="h-8 text-right font-mono tabular-nums"
              {...field}
              value={amountValue(field.value)}
            />
          )}
        />
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.rentAmount`}
          render={({ field }) => (
            <Input
              inputMode="decimal"
              className="h-8 text-right font-mono tabular-nums"
              {...field}
              value={amountValue(field.value)}
              onBlur={(e) => {
                field.onBlur();
                // Offer the usual rate once, as a starting figure. It is only a
                // convenience: whatever the sheet says wins, and the rate shown
                // beneath says what was actually entered.
                const value = Number(e.target.value) || 0;
                const current = Number(form.getValues(`lines.${index}.managementAmount`)) || 0;
                if (value > 0 && current === 0) {
                  form.setValue(
                    `lines.${index}.managementAmount`,
                    Math.round(value * MANAGEMENT_RATE[lineType] * 100) / 100,
                    { shouldDirty: true },
                  );
                }
              }}
            />
          )}
        />
      </td>
      <td className="px-2 py-1">
        <FormField
          control={form.control}
          name={`lines.${index}.managementAmount`}
          render={({ field }) => (
            <Input
              inputMode="decimal"
              className="h-8 text-right font-mono tabular-nums"
              {...field}
              value={amountValue(field.value)}
            />
          )}
        />
        {impliedRate !== null && rent > 0 && (
          <p
            className={cn(
              "mt-1 text-right text-[0.7rem] tabular-nums",
              rateLooksOff ? "font-medium text-amber-700 dark:text-amber-500" : "text-muted-foreground",
            )}
          >
            {mgmt > 0
              ? `${(impliedRate * 100).toFixed(2)}%`
              : `no management — ${(expectedRate * 100).toFixed(0)}% expected`}
          </p>
        )}
      </td>
      {amountCell("dewa")}
      {amountCell("internet")}
      {amountCell("accessCard")}
      {amountCell("wifi")}
      {amountCell("other")}
      <td className="px-2 py-2 text-right font-mono text-sm font-semibold tabular-nums">
        {formatMoney(net)}
      </td>
      <td className="px-1 py-1">
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onRemove} aria-label="Remove line">
            <Trash2Icon className="size-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}
