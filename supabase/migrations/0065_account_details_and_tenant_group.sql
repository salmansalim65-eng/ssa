-- Chart of Accounts "Details" tab + tenant group.
--   * id_number / phone / email / country: party details captured on any leaf
--     account (used most for tenant/party accounts). country is an ISO country
--     code (e.g. 'AE', 'PK') so leases can filter tenants by country.
--   * is_tenant_group: marks a GROUP account as the tenant group. Leaf accounts
--     under a tenant group are the tenant master that leases pick from.
alter table accounting.chart_of_accounts
  add column if not exists id_number text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists country text,
  add column if not exists is_tenant_group boolean not null default false;
