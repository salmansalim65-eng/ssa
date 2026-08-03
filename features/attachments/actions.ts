"use server";

import { createClient } from "@/lib/supabase/server";

async function getCurrentCompanyId() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("core").rpc("current_company_id");
  if (error || !data) throw new Error("No active company");
  return data;
}

/**
 * Uploads a file to Supabase Storage and records its metadata in
 * core.attachments. Runs server-side (via a Server Action) rather than
 * directly from the browser so every mutation in the app goes through the
 * same authenticated-server-client path — storage RLS still applies since
 * the server client carries the caller's session.
 */
export async function uploadAttachment(
  bucket: string,
  entityType: string,
  entityId: string,
  formData: FormData,
) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided" };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const companyId = await getCurrentCompanyId();

  const path = `${companyId}/${entityType}/${entityId}/${crypto.randomUUID()}-${file.name}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, { contentType: file.type || "application/octet-stream" });
  if (uploadError) return { error: uploadError.message };

  const { data: attachment, error: insertError } = await supabase
    .schema("core")
    .from("attachments")
    .insert({
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      bucket,
      path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: user.user!.id,
    })
    .select("*")
    .single();

  if (insertError || !attachment) {
    await supabase.storage.from(bucket).remove([path]);
    return { error: insertError?.message ?? "Failed to record attachment" };
  }

  return { attachment };
}

export async function deleteAttachment(id: string) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data: attachment } = await supabase
    .schema("core")
    .from("attachments")
    .select("bucket, path")
    .eq("id", id)
    .single();

  if (attachment) {
    await supabase.storage.from(attachment.bucket).remove([attachment.path]);
  }

  const { error } = await supabase
    .schema("core")
    .from("attachments")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.user!.id })
    .eq("id", id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function getSignedUrl(bucket: string, path: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
