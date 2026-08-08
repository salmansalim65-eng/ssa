import "server-only";

import { cache } from "react";

import type { PermissionAction } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * All actions the current user is allowed for a module, fetched in a single RPC.
 * Wrapped in React `cache()` so a page that checks several actions on the same
 * module (e.g. a voucher detail page checks edit/approve/reject/post/delete/
 * create) resolves to ONE database round trip per request instead of one per
 * action.
 */
export const getModulePermissions = cache(
  async (moduleKey: string): Promise<Set<PermissionAction>> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("core")
      .rpc("user_permitted_actions", { p_module_key: moduleKey });

    if (error || !data) return new Set();
    return new Set(data as PermissionAction[]);
  },
);

/**
 * Server-side permission check. UI hides/disables affordances the user can't
 * use, but every mutating server action calls this too — RLS already blocks
 * unauthorized writes at the database, this just gives a clean error instead
 * of a raw Postgres RLS failure.
 */
export async function hasPermission(moduleKey: string, action: PermissionAction) {
  return (await getModulePermissions(moduleKey)).has(action);
}

export async function requirePermission(moduleKey: string, action: PermissionAction) {
  const allowed = await hasPermission(moduleKey, action);
  if (!allowed) {
    throw new Error(`Not permitted: ${moduleKey}.${action}`);
  }
}
