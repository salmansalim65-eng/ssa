import { redirect } from "next/navigation";

import { hasPermission } from "@/lib/auth/permissions";
import { NewAssetForm } from "./new-asset-form";

export default async function NewAssetPage() {
  const canCreate = await hasPermission("assets", "create");
  if (!canCreate) redirect("/assets");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New asset</h1>
      <NewAssetForm />
    </div>
  );
}
