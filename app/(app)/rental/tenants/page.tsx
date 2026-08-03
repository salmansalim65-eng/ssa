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
import { AddTenantDialog } from "./add-tenant-dialog";
import { TenantRowActions } from "./tenant-row-actions";

export default async function TenantsPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: tenants }, canCreate, canEdit] = await Promise.all([
    supabase
      .schema("rental")
      .from("tenants")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name"),
    hasPermission("tenants", "create"),
    hasPermission("tenants", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="text-sm text-muted-foreground">Shared between UAE and Pakistan rental leases.</p>
        </div>
        {canCreate && <AddTenantDialog />}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>ID number</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tenants ?? []).map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell>{t.id_number ?? "—"}</TableCell>
              <TableCell>{t.phone ?? "—"}</TableCell>
              <TableCell>{t.email ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={t.is_active ? "success" : "secondary"}>{t.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell>
                <TenantRowActions
                  tenantId={t.id}
                  isActive={t.is_active}
                  canEdit={canEdit}
                  defaultValues={{
                    name: t.name,
                    idNumber: t.id_number ?? "",
                    phone: t.phone ?? "",
                    email: t.email ?? "",
                    address: t.address ?? "",
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
          {(tenants ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No tenants yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
