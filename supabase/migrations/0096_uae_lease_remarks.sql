-- Free-text remarks captured on a UAE lease (optional notes). Written by the
-- lease create/edit forms; nullable so existing leases are unaffected.
alter table rental.uae_leases
  add column if not exists remarks text;
