-- An invoice that does not need a lease behind it.
--
-- A short-term letting IS the line on the agent's sheet: a unit, two dates and
-- an amount. Making a lease for each one, with a payment schedule to generate
-- an invoice from, is a week of ceremony for a three-week stay — and the lease
-- then exists only to justify the invoice, which is the tail wagging the dog.
--
-- So lease_id becomes optional. A rent statement raises its invoices directly,
-- and they behave like any other from there: they age, they appear among the
-- outstanding bills, and a receipt is adjusted against them in the usual way.
-- An invoice raised from a lease is unchanged and still carries it.
alter table rental.uae_rent_invoices alter column lease_id drop not null;
comment on column rental.uae_rent_invoices.lease_id is
  'The lease this invoice was generated from. NULL for one raised directly by a rent statement — a short-term letting is the statement line itself, not a lease.';

-- Which statement line raised it, so the two can be read back against each
-- other — and so deleting a statement knows what it has to take with it.
alter table rental.uae_rent_invoices
  add column if not exists rent_statement_line_id uuid references rental.rent_statement_lines(id) on delete set null;
create index if not exists idx_uae_rent_invoices_statement_line
  on rental.uae_rent_invoices (rent_statement_line_id);

-- A short-term line records the invoice it RAISED; a long-term line records
-- the invoice it MATCHES, which already existed. Two different facts, so two
-- different columns rather than one that means whichever you assumed.
alter table rental.rent_statement_lines
  add column if not exists raised_invoice_id uuid references rental.uae_rent_invoices(id) on delete set null;
comment on column rental.rent_statement_lines.raised_invoice_id is
  'The invoice this short-term line raised when the statement was posted.';
comment on column rental.rent_statement_lines.matched_invoice_id is
  'For a long-term line: the invoice that ALREADY existed and that this line restates. Nothing is raised for it.';
