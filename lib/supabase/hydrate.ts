import type { createClient } from "./server";

// The client returned by `createClient()`. Callers all pass this exact value,
// so typing the parameter this way keeps every call site clean.
type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Minimal view of the query chain used below. The real client's `.schema()` is
// a constrained generic keyed to the `Database` schema union, which rejects the
// dynamic `string` schema `fetchRefs` is designed to take; this structural cast
// steps around that without resorting to `any`.
type DynamicSchemaQuery = {
  schema: (name: string) => {
    from: (table: string) => {
      select: (columns: string) => {
        in: (column: string, values: string[]) => Promise<{ data: unknown }>;
      };
    };
  };
};

/**
 * PostgREST on this project does not resolve foreign-key *embeds* that cross a
 * schema boundary (e.g. `rental.uae_leases.asset_id -> assets.assets`): it only
 * searches for the relationship within the origin table's own schema and returns
 * PGRST200 ("Could not find a relationship ... in the schema cache"). A whole
 * query fails if any single embed crosses schemas, which is why a page that only
 * looked up an asset code ended up 404ing.
 *
 * `fetchRefs` replaces a cross-schema embed with an explicit, batched follow-up
 * query against the target schema, returning a Map keyed by `id` so callers can
 * stitch the related rows back in. Same-schema embeds still work and are left in
 * place at the call sites.
 */
export async function fetchRefs<T extends { id: string }>(
  supabase: ServerClient,
  schema: string,
  table: string,
  columns: string,
  ids: (string | null | undefined)[],
): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data } = await (supabase as unknown as DynamicSchemaQuery)
    .schema(schema)
    .from(table)
    .select(`id, ${columns}`)
    .in("id", unique);

  return new Map(((data as T[]) ?? []).map((row) => [row.id, row]));
}
