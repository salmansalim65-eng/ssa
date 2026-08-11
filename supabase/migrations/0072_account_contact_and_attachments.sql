-- Chart-of-Accounts party accounts (tenants/landlords) gain a contact person and
-- three document slots — an ID document, a police verification, and a rent
-- agreement — each pointing at a row in the shared core.attachments store (same
-- single-attachment pattern assets use for the title deed). ON DELETE SET NULL so
-- removing the attachment record just clears the slot.
alter table accounting.chart_of_accounts
  add column if not exists contact_person text,
  add column if not exists id_attachment_id uuid references core.attachments(id) on delete set null,
  add column if not exists police_verification_attachment_id uuid references core.attachments(id) on delete set null,
  add column if not exists rent_agreement_attachment_id uuid references core.attachments(id) on delete set null;
