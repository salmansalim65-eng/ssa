-- Free-text remarks captured on a PK lease (optional notes). Written by the
-- lease create/edit forms; nullable so existing leases are unaffected.
alter table rental.pk_leases
  add column if not exists remarks text;
