-- A combined rent voucher was only counting ONE property's expenses.
--
-- v_rental_income joins the invoice to its lease (uri.lease_id) and reads
-- lease_expenses for that lease alone. For an HH/UAE voucher that is one invoice
-- across MANY properties, that is the first property only: URI-000095 covers
-- seven, whose expenses come to 6,171, and the view reported 450.
--
-- So the invoice's net read 5,721 too high, and everything downstream inherited
-- it — the Rent Balance, the outstanding figure, and the bill offered in the
-- receipt adjustment dialog. A receipt for exactly the overdue amount filled
-- that inflated bill first and left the next one short by the same 5,721.
--
-- A combined voucher's properties are the leases sharing its document number, so
-- that is what the expenses are summed over. An invoice billed off a payment
-- schedule is one instalment of one lease and keeps reading its own.

create or replace view reporting.v_rental_income as
 WITH uae AS (
         SELECT uri.company_id,
            'UAE'::text AS country,
            uri.id AS invoice_id,
            uri.voucher_no,
            a.asset_code,
            a.asset_name,
            t.name AS tenant_name,
            uri.invoice_date,
            uri.due_date,
            uri.amount,
            uri.outstanding_balance,
            cur.code AS currency_code,
            je.status,
            uri.exchange_rate,
            ul.lease_type,
            t.account_id AS tenant_account_id,
            round(uri.amount *
                CASE
                    WHEN ul.lease_type = 'hh'::text THEN 0.10
                    ELSE 0.05
                END, 2) AS agent_share,
            COALESCE(ul.expense_amount, 0::numeric)
            + CASE
                WHEN uri.schedule_id IS NULL AND ul.document_no IS NOT NULL THEN
                  COALESCE(( SELECT sum(le.amount)
                       FROM rental.lease_expenses le
                         JOIN rental.uae_leases ul2 ON ul2.id = le.lease_id AND ul2.deleted_at IS NULL
                      WHERE ul2.document_no = ul.document_no), 0::numeric)
                ELSE
                  COALESCE(( SELECT sum(le.amount)
                       FROM rental.lease_expenses le
                      WHERE le.lease_id = ul.id), 0::numeric)
              END
            + COALESCE(( SELECT sum(pe.amount) AS sum
                   FROM rental.payment_invoice_expenses pe
                  WHERE pe.uae_invoice_id = uri.id), 0::numeric) AS other_expenses,
            COALESCE(( SELECT sum(ra.amount) AS sum
                   FROM rental.receipt_invoice_allocations ra
                  WHERE ra.uae_invoice_id = uri.id), 0::numeric) AS received,
            COALESCE(( SELECT sum(
                        CASE
                            WHEN ja.direction = 'increase'::text THEN ja.amount
                            ELSE - ja.amount
                        END) AS sum
                   FROM rental.journal_invoice_allocations ja
                  WHERE ja.uae_invoice_id = uri.id), 0::numeric) AS jv_adjustment
           FROM rental.uae_rent_invoices uri
             JOIN rental.uae_leases ul ON ul.id = uri.lease_id
             JOIN assets.assets a ON a.id = ul.asset_id
             JOIN rental.tenants t ON t.id = ul.tenant_id
             JOIN core.currencies cur ON cur.id = uri.currency_id
             JOIN accounting.journal_entries je ON je.id = uri.journal_entry_id
          WHERE je.status = 'posted'::text
        )
 SELECT uae.company_id,
    uae.country,
    uae.invoice_id,
    uae.voucher_no,
    uae.asset_code,
    uae.asset_name,
    uae.tenant_name,
    uae.invoice_date,
    uae.due_date,
    uae.amount,
    uae.outstanding_balance,
    uae.currency_code,
    uae.status,
    uae.exchange_rate,
    uae.lease_type,
    uae.agent_share,
    uae.other_expenses,
    uae.amount - uae.agent_share - uae.other_expenses AS net_amount,
    GREATEST(0::numeric, uae.amount - uae.agent_share - uae.other_expenses + uae.jv_adjustment - uae.received) AS net_outstanding,
    uae.tenant_account_id
   FROM uae
UNION ALL
 SELECT pri.company_id,
    'PK'::text AS country,
    pri.id AS invoice_id,
    pri.voucher_no,
    a.asset_code,
    a.asset_name,
    t.name AS tenant_name,
    pri.invoice_date,
    pri.due_date,
    pri.total_amount AS amount,
    pri.outstanding_amount AS outstanding_balance,
    cur.code AS currency_code,
    je.status,
    pri.exchange_rate,
    NULL::text AS lease_type,
    0::numeric AS agent_share,
    COALESCE(( SELECT sum(pe.amount) AS sum
           FROM rental.payment_invoice_expenses pe
          WHERE pe.pk_invoice_id = pri.id), 0::numeric) AS other_expenses,
    pri.total_amount - COALESCE(( SELECT sum(pe.amount) AS sum
           FROM rental.payment_invoice_expenses pe
          WHERE pe.pk_invoice_id = pri.id), 0::numeric) AS net_amount,
    GREATEST(0::numeric, pri.total_amount - COALESCE(( SELECT sum(pe.amount) AS sum
           FROM rental.payment_invoice_expenses pe
          WHERE pe.pk_invoice_id = pri.id), 0::numeric) + COALESCE(( SELECT sum(
                CASE
                    WHEN ja.direction = 'increase'::text THEN ja.amount
                    ELSE - ja.amount
                END) AS sum
           FROM rental.journal_invoice_allocations ja
          WHERE ja.pk_invoice_id = pri.id), 0::numeric) - COALESCE(( SELECT sum(ra.amount) AS sum
           FROM rental.receipt_invoice_allocations ra
          WHERE ra.pk_invoice_id = pri.id), 0::numeric)) AS net_outstanding,
    t.account_id AS tenant_account_id
   FROM rental.pk_rent_invoices pri
     JOIN rental.pk_leases pl ON pl.id = pri.lease_id
     JOIN assets.assets a ON a.id = pl.asset_id
     JOIN rental.tenants t ON t.id = pl.tenant_id
     JOIN core.currencies cur ON cur.id = pri.currency_id
     JOIN accounting.journal_entries je ON je.id = pri.journal_entry_id
  WHERE je.status = 'posted'::text;
