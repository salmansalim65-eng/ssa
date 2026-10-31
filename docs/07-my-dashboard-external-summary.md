# My Dashboard: figures from MBL, RMI and VISTA

My Dashboard shows SSA's own figures from SSA's database. MBL's, RMI's and
VISTA's figures live in **their** databases, which SSA cannot read.

This document is the contract that lets each of those apps publish its own
headline figures, and the two environment variables SSA needs to read them.

## Why not just share a database key

The short way would be to put each app's Supabase **service-role key** into
SSA's environment and read their tables directly. That key bypasses row-level
security, so SSA would hold full read *and write* access to another company's
entire database in order to display four numbers. If SSA were ever
compromised, so would every app whose key it held.

Each app publishing one read-only endpoint instead means SSA holds a token that
can do exactly one thing: read those numbers. A leaked token loses the numbers
and nothing else.

## The endpoint each app publishes

One `GET` route, returning JSON, protected by a bearer token.

```
GET https://mbl-erp.vercel.app/api/summary
Authorization: Bearer <the shared token>
```

Response:

```json
{
  "asOf": "31 Oct 2026",
  "figures": [
    { "label": "Rent outstanding", "currency": "PKR", "amount": 1250000 },
    { "label": "Cash & bank",      "currency": "PKR", "amount": 340000 },
    { "label": "Awaiting approval", "currency": null,  "amount": 3 }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `asOf` | no | Any short string, shown beside the app's name. Up to 40 characters. |
| `figures` | yes | Up to **8**. More than that is a report, not a card. |
| `figures[].label` | yes | 1–40 characters. Shown as given. |
| `figures[].currency` | no | A code such as `PKR` or `SAR`. `null` or absent for a plain count. |
| `figures[].amount` | yes | A **number**, not a formatted string. SSA does the formatting. |

`figures` is a list rather than named fields on purpose: when MBL adds a
figure, MBL ships it and the card grows. SSA does not have to be changed or
redeployed to learn a new number's name.

Anything outside this shape is rejected and the card reads "answered in an
unexpected shape" — SSA will not guess.

## A route to copy (Next.js App Router)

```ts
// app/api/summary/route.ts
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const expected = process.env.SUMMARY_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Length-safe comparison; a plain === leaks timing on long tokens.
  if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(
    Buffer.from(given), Buffer.from(expected),
  )) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Read your own figures here, however this app already reads them.
  const figures = [
    { label: "Rent outstanding", currency: "PKR", amount: await outstanding() },
    { label: "Cash & bank", currency: "PKR", amount: await cashAndBank() },
  ];

  return NextResponse.json({
    asOf: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    figures,
  });
}
```

Generate the token with `openssl rand -base64 32` and set it as
`SUMMARY_TOKEN` in **that** app's environment. The same value goes into SSA as
`MBL_SUMMARY_TOKEN`, `RMI_SUMMARY_TOKEN` or `VISTA_SUMMARY_TOKEN`.

## Setting it up in SSA

In Vercel, on the **SSA** project: Settings → Environment Variables → Add.
Tick Production and Preview, then redeploy once.

| Variable | Value |
| --- | --- |
| `MBL_SUMMARY_URL` | `https://mbl-erp.vercel.app/api/summary` |
| `MBL_SUMMARY_TOKEN` | the token MBL's `SUMMARY_TOKEN` is set to |
| `RMI_SUMMARY_URL` | `https://erp.rolemodel.pk/api/summary` |
| `RMI_SUMMARY_TOKEN` | the token RMI's `SUMMARY_TOKEN` is set to |
| `VISTA_SUMMARY_URL` | `https://erp.vista-group.co/api/summary` |
| `VISTA_SUMMARY_TOKEN` | the token VISTA's `SUMMARY_TOKEN` is set to |

Only the apps whose `*_SUMMARY_URL` is set get a card. With none of them set, the
"Other systems" section does not appear at all.

The URL must be `https://` — the token travels in a header, so the connection
has to be encrypted.

## How SSA behaves

- **Cached for 5 minutes.** A dashboard opened ten times an hour makes one
  request per app, not ten.
- **6 second timeout.** A slow neighbour costs its own card, not the page; the
  section is streamed, so SSA's own figures render first either way.
- **A failure shows as a card, not silence.** "the token was rejected", "the
  endpoint was not found", "did not answer in time" — silence would be
  indistinguishable from a figure of zero, or from a mistyped variable name.
- **The token is never printed.** Failure messages are written by SSA rather
  than taken from the thrown error, because a fetch error can quote the
  request, and the request carries the token.

Implemented in `lib/my-dashboard/external-summary.ts` and
`app/(app)/my-dashboard/external-reports.tsx`.
