# Folder Structure

Domain-driven, feature-first layout on top of Next.js App Router. Route
files stay thin (composition only); logic lives in `features/*`.

```
.
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── reset-password/page.tsx
│   │   └── layout.tsx
│   ├── (app)/                         # authenticated shell
│   │   ├── layout.tsx                 # sidebar + header + breadcrumbs
│   │   ├── dashboard/page.tsx
│   │   ├── assets/
│   │   │   ├── page.tsx               # list
│   │   │   ├── [assetId]/page.tsx     # detail
│   │   │   └── new/page.tsx
│   │   ├── purchases/...
│   │   ├── sales/...
│   │   ├── valuations/...
│   │   ├── rental/
│   │   │   ├── uae/{leases,invoices}/...
│   │   │   └── pakistan/{leases,invoices}/...
│   │   ├── accounting/
│   │   │   ├── chart-of-accounts/...
│   │   │   ├── cost-centers/...
│   │   │   └── vouchers/
│   │   │       ├── receipt/...
│   │   │       ├── payment/...
│   │   │       ├── pdc-payment/...
│   │   │       ├── pdc-receipt/...
│   │   │       ├── cheque-return/...
│   │   │       ├── journal/...
│   │   │       ├── jv-maintenance/...
│   │   │       └── opening-balance/...
│   │   ├── reports/
│   │   │   ├── general-ledger/page.tsx
│   │   │   ├── trial-balance/page.tsx
│   │   │   ├── balance-sheet/page.tsx
│   │   │   ├── profit-and-loss/page.tsx
│   │   │   ├── cash-book/page.tsx
│   │   │   ├── bank-book/page.tsx
│   │   │   ├── asset-register/page.tsx
│   │   │   ├── rental-income/page.tsx
│   │   │   ├── outstanding-rent/page.tsx
│   │   │   ├── currency-exchange/page.tsx
│   │   │   └── voucher-register/page.tsx
│   │   └── admin/
│   │       ├── companies/...
│   │       ├── users/...
│   │       ├── roles/...
│   │       ├── permissions/...
│   │       ├── currencies/...
│   │       ├── exchange-rates/...
│   │       ├── document-sequences/...
│   │       └── approval-workflows/...
│   └── api/
│       ├── reports/[type]/pdf/route.ts
│       ├── reports/[type]/xlsx/route.ts
│       └── webhooks/...
│
├── features/                          # application/domain layer
│   ├── assets/            {actions.ts, services.ts, schemas.ts, types.ts, components/}
│   ├── purchases/         ...
│   ├── sales/             ...
│   ├── valuations/        ...
│   ├── rental-uae/        ...
│   ├── rental-pk/         ...
│   ├── accounting/
│   │   ├── chart-of-accounts/...
│   │   ├── cost-centers/...
│   │   ├── journal-engine/         # posting, balancing helpers
│   │   ├── approval-engine/        # generic workflow client helpers
│   │   └── vouchers/{receipt,payment,pdc,cheque-return,journal,opening-balance}/
│   ├── reports/            {queries.ts per report}
│   ├── admin/              {companies,users,roles,permissions,currencies}/
│   └── dashboard/          {queries.ts, components/}
│
├── components/
│   ├── ui/                 # shadcn/ui primitives (button, dialog, form, ...)
│   ├── data-table/         # shared table: sort/filter/paginate/export/print
│   ├── forms/              # shared form field wrappers (RHF + Zod)
│   └── layout/             # sidebar, header, breadcrumbs, theme-toggle
│
├── lib/
│   ├── supabase/           {client.ts, server.ts, middleware.ts}
│   ├── auth/               {session.ts, permissions.ts}
│   ├── currency/           {convert.ts}
│   ├── numbering/          {getNextDocumentNumber.ts}
│   ├── audit/              {types.ts}
│   ├── export/             {xlsx.ts, pdf.ts}
│   └── utils/              {formatters, date helpers}
│
├── types/
│   ├── database.types.ts   # generated: `supabase gen types typescript`
│   └── shared.ts
│
├── supabase/
│   ├── migrations/         # 0001_..., 0002_... one per reviewed module
│   ├── seed.sql
│   └── config.toml
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/                   # this design documentation
├── middleware.ts           # auth guard + active-company resolution
├── tailwind.config.ts
├── next.config.ts
└── package.json
```

## Conventions

- One `features/<domain>` folder per module in the roadmap; nothing in
  `app/` imports another route's internals — only `features/*` and
  `components/*`.
- Server Actions are the default mutation path; `app/api/*` route handlers
  are reserved for exports, PDF rendering, and webhooks that need a raw
  HTTP contract.
- All Zod schemas for a domain live beside its actions
  (`features/<domain>/schemas.ts`) and are the single source of truth for
  both client-side RHF validation and server-side re-validation.
- `types/database.types.ts` is regenerated from Supabase after every
  migration and is the only place `Database` types are imported from.
