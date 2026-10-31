"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { isMissingTable, NOTES_MIGRATION } from "@/lib/my-dashboard/notes-availability";
import { noteSchema, type NoteInput } from "./schemas";

const PATH = "/my-dashboard";

/**
 * Notes are personal, so these actions check nothing but who is signed in.
 *
 * There is no `notes` entry in the permission matrix and there should not be:
 * every write is scoped to `user_id = auth.uid()` in both the statement and
 * the row policy, which is a stronger guarantee than a grant anyone can edit.
 */
async function context() {
  const [user, companyId, supabase] = await Promise.all([requireUser(), getCurrentCompanyId(), createClient()]);
  return { userId: user.id, companyId, supabase };
}

function rowFrom(input: NoteInput) {
  return {
    title: input.title || null,
    body: input.body || null,
    items: input.items,
    colour: input.colour,
    pinned: input.pinned,
  };
}

/** Until the migration runs the table is not there; say so instead of a 42P01. */
function friendlyError(error: { code?: string; message?: string }) {
  return isMissingTable(error) ? `Notes need migration ${NOTES_MIGRATION} to be run first.` : error.message;
}

export async function createNote(input: NoteInput) {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { userId, companyId, supabase } = await context();
  const { error } = await supabase
    .schema("core")
    .from("notes")
    .insert({ ...rowFrom(parsed.data), company_id: companyId, user_id: userId });
  if (error) return { error: friendlyError(error) };

  revalidatePath(PATH);
  return { success: true };
}

export async function updateNote(id: string, input: NoteInput) {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { userId, companyId, supabase } = await context();
  const { error } = await supabase
    .schema("core")
    .from("notes")
    .update({ ...rowFrom(parsed.data), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) return { error: friendlyError(error) };

  revalidatePath(PATH);
  return { success: true };
}

/**
 * Ticking a checklist line is its own action.
 *
 * The alternative is sending the whole note back on every tick, which loses
 * whatever was being typed into it at the time — and a checkbox that only
 * works when the note is otherwise untouched is a checkbox people stop using.
 */
export async function setNoteItems(id: string, items: { text: string; done: boolean }[]) {
  const { userId, companyId, supabase } = await context();
  const { error } = await supabase
    .schema("core")
    .from("notes")
    .update({ items, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) return { error: friendlyError(error) };

  revalidatePath(PATH);
  return { success: true };
}

export async function setNotePinned(id: string, pinned: boolean) {
  const { userId, companyId, supabase } = await context();
  const { error } = await supabase
    .schema("core")
    .from("notes")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) return { error: friendlyError(error) };

  revalidatePath(PATH);
  return { success: true };
}

/**
 * Soft delete, like every other master in SSA: a note deleted by mistake is
 * recoverable in the database rather than gone.
 */
export async function deleteNote(id: string) {
  const { userId, companyId, supabase } = await context();
  const { error } = await supabase
    .schema("core")
    .from("notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) return { error: friendlyError(error) };

  revalidatePath(PATH);
  return { success: true };
}
