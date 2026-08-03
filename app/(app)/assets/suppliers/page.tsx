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
import { AddSupplierDialog } from "./add-supplier-dialog";
import { SupplierRowActions } from "./supplier-row-actions";

export default async function SuppliersPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: suppliers }, canCreate, canEdit] = await Promise.all([
    supabase
      .schema("assets")
      .from("suppliers")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name"),
    hasPermission("purchase_voucher", "create"),
    hasPermission("purchase_voucher", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground">Used when recording a Purchase Voucher.</p>
        </div>
        {canCreate && <AddSupplierDialog />}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(suppliers ?? []).map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>{s.contact_person ?? "—"}</TableCell>
              <TableCell>{s.phone ?? "—"}</TableCell>
              <TableCell>{s.email ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={s.is_active ? "success" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell>
                <SupplierRowActions
                  supplierId={s.id}
                  isActive={s.is_active}
                  canEdit={canEdit}
                  defaultValues={{
                    name: s.name,
                    contactPerson: s.contact_person ?? "",
                    phone: s.phone ?? "",
                    email: s.email ?? "",
                    address: s.address ?? "",
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
          {(suppliers ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No suppliers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
