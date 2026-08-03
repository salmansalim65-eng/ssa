import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  VOUCHER_TYPES,
  VOUCHER_TYPE_DEFAULT_PREFIX,
  VOUCHER_TYPE_LABELS,
} from "@/lib/vouchers/meta";
import { DocumentSequenceDialog } from "./document-sequence-dialog";

export default async function DocumentSequencesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: sequences }, canEdit] = await Promise.all([
    supabase.schema("core").from("document_sequences").select("*").eq("company_id", companyId),
    hasPermission("document_sequences", "edit"),
  ]);

  const byVoucherType = new Map(sequences?.map((s) => [s.voucher_type, s]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Document Sequences</h1>
        <p className="text-sm text-muted-foreground">
          Configure the prefix and numbering format each voucher type uses,
          e.g. PV-000001. Numbers are handed out atomically when a voucher is
          posted in Phase 5+.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Voucher type</TableHead>
            <TableHead>Prefix</TableHead>
            <TableHead>Next number</TableHead>
            <TableHead>Reset policy</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {VOUCHER_TYPES.map((voucherType) => {
            const seq = byVoucherType.get(voucherType);
            const padding = seq?.padding ?? 6;
            const nextNumber = seq?.next_number ?? 1;
            const prefix = seq?.prefix ?? VOUCHER_TYPE_DEFAULT_PREFIX[voucherType];

            return (
              <TableRow key={voucherType}>
                <TableCell className="font-medium">{VOUCHER_TYPE_LABELS[voucherType]}</TableCell>
                <TableCell>
                  {seq ? (
                    <span className="font-mono">{seq.prefix}</span>
                  ) : (
                    <Badge variant="secondary">Not configured</Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {prefix}-{String(nextNumber).padStart(padding, "0")}
                </TableCell>
                <TableCell className="capitalize">{seq?.reset_policy ?? "—"}</TableCell>
                <TableCell>
                  {canEdit && (
                    <DocumentSequenceDialog
                      voucherType={voucherType}
                      label={VOUCHER_TYPE_LABELS[voucherType]}
                      triggerLabel={seq ? "Edit" : "Configure"}
                      defaultValues={{
                        prefix,
                        padding,
                        resetPolicy: seq?.reset_policy ?? "never",
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
