import { ContactIcon } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { AddTenantDialog } from "./add-tenant-dialog";
import { TenantRowActions } from "./tenant-row-actions";

export default async function TenantsPage() {
  const supabase = await createClient();

  const companyId = await getCurrentCompanyId();

  const [{ data: tenants }, canCreate, canEdit, canDelete] = await Promise.all([
    supabase
      .schema("rental")
      .from("tenants")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name"),
    hasPermission("tenants", "create"),
    hasPermission("tenants", "edit"),
    hasPermission("tenants", "delete"),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rentals"
        title="Tenants"
        description="Shared between UAE and Pakistan rental leases."
        actions={canCreate ? <AddTenantDialog /> : undefined}
      />

      {(tenants ?? []).length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title="No tenants yet"
          description="Tenants are shared between UAE and Pakistan rental leases."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
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
                    <StatusBadge active={t.is_active} />
                  </TableCell>
                  <TableCell>
                    <TenantRowActions
                      tenantId={t.id}
                      tenantName={t.name}
                      isActive={t.is_active}
                      canEdit={canEdit}
                      canDelete={canDelete}
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
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
