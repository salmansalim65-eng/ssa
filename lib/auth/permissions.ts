import "server-only";

import type { PermissionAction } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side permission check. UI hides/disables affordances the user can't
 * use, but every mutating server action calls this too — RLS already blocks
 * unauthorized writes at the database, this just gives a clean error instead
 * of a raw Postgres RLS failure.
 */
export async function hasPermission(moduleKey: string, action: PermissionAction) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("core")
    .rpc("user_has_permission", { p_module_key: moduleKey, p_action: action });

  if (error) return false;
  return Boolean(data);
}

export async function requirePermission(moduleKey: string, action: PermissionAction) {
  const allowed = await hasPermission(moduleKey, action);
  if (!allowed) {
    throw new Error(`Not permitted: ${moduleKey}.${action}`);
  }
}
