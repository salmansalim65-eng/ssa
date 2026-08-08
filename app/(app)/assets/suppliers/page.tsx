import { Users2Icon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
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

  const rows = suppliers ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Assets & Property"
        title="Suppliers"
        description="Vendors used when recording a Purchase Voucher."
        actions={canCreate && <AddSupplierDialog />}
      />

      <div className="rounded-xl border bg-card shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users2Icon}
            title="No suppliers yet"
            description="Add a supplier to reference it on purchase vouchers."
            action={canCreate && <AddSupplierDialog />}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.contact_person ?? "—"}</TableCell>
                  <TableCell>{s.phone ?? "—"}</TableCell>
                  <TableCell>{s.email ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge active={s.is_active} />
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
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
