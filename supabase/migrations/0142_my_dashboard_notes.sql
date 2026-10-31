-- Notes on My Dashboard: the sticky notes and checklists a day is run off.
--
-- A note belongs to ONE person, not to the company. Two people sharing a board
-- of half-written reminders helps neither of them, and the moment a note is
-- shared it stops being a scratchpad and starts needing an owner, an audit
-- trail and a permission. So the row carries a user_id and the policies read
-- auth.uid(): nobody else sees your notes, administrators included.
--
-- The checklist lives in the same row as jsonb rather than a child table. A
-- checklist is only ever read and written whole, with its note; a second table
-- would buy ordering and integrity nobody asks of a shopping list, at the cost
-- of a join on every read.

create table if not exists core.notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies(id) on delete cascade,
  user_id uuid not null,
  title text,
  body text,
  -- [{ "text": "...", "done": false }, ...] — the checklist, in display order.
  items jsonb not null default '[]'::jsonb,
  colour text not null default 'yellow'
    check (colour in ('yellow', 'blue', 'green', 'pink', 'purple', 'slate')),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);
comment on table core.notes is
  'Personal sticky notes and checklists shown on My Dashboard. Private to the owning user — the policies read auth.uid(), so no permission grants access to another person''s notes.';
comment on column core.notes.items is
  'The checklist, as [{text, done}] in display order. Read and written whole with the note.';

create index if not exists idx_notes_user
  on core.notes (user_id, company_id, pinned desc, created_at desc) where deleted_at is null;

alter table core.notes enable row level security;

-- Every policy is the same clause: your own notes, in the company you are in.
-- Nothing here consults the permission matrix, by design.
drop policy if exists notes_select on core.notes;
create policy notes_select on core.notes for select
  using (user_id = auth.uid() and company_id = core.current_company_id() and deleted_at is null);
drop policy if exists notes_insert on core.notes;
create policy notes_insert on core.notes for insert
  with check (user_id = auth.uid() and company_id = core.current_company_id());
drop policy if exists notes_update on core.notes;
create policy notes_update on core.notes for update
  using (user_id = auth.uid() and company_id = core.current_company_id())
  with check (user_id = auth.uid() and company_id = core.current_company_id());
drop policy if exists notes_delete on core.notes;
create policy notes_delete on core.notes for delete
  using (user_id = auth.uid() and company_id = core.current_company_id());

grant select, insert, update, delete on core.notes to authenticated;
