-- The AED currency was seeded with the Arabic dirham mark (د.إ), which reads
-- inconsistently next to the Latin marks used for the other currencies (SR, Rs,
-- $, €, £) and renders awkwardly in reports and invoices. Switch it to the ISO
-- code "AED" so the symbol is consistent across the whole ERP. Idempotent, and
-- covers both existing databases and fresh deployments seeded from 0002.
update core.currencies set symbol = 'AED' where code = 'AED';
