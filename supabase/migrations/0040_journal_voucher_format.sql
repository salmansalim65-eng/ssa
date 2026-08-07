-- =============================================================================
-- Journal Voucher gets the header + grid format from the screenshot: a Due Date
-- and REF_NO on the header (currency + conversion already live on the journal
-- entry), and per-line Cost Centre / Reference / Remarks in the grid. The line
-- reference is a generic per-line field on journal_entry_lines (Remarks maps to
-- the existing description).
--
-- JV Maintenance is made identical to a Journal Voucher: its maintenance-only
-- columns (original_jv_id, adjustment_reason) become optional and it gains the
-- same due_date + narration header fields.
-- =============================================================================

alter table accounting.journal_entry_lines add column if not exists reference text;

alter table accounting.journal_vouchers add column if not exists due_date date;
alter table accounting.journal_vouchers add column if not exists ref_no text;
alter table accounting.journal_vouchers alter column narration drop not null;

alter table accounting.jv_maintenance_vouchers alter column original_jv_id drop not null;
alter table accounting.jv_maintenance_vouchers alter column adjustment_reason drop not null;
alter table accounting.jv_maintenance_vouchers add column if not exists entry_date date;
alter table accounting.jv_maintenance_vouchers add column if not exists due_date date;
alter table accounting.jv_maintenance_vouchers add column if not exists narration text;

select pg_notify('pgrst', 'reload schema');
