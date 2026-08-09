# Project Notes

Running log of verification findings and decisions. Newest first.

---

## 2026-08-09 — Admin auto-post verification

**Question:** Do Administrator-created vouchers auto-approve and auto-post,
bypassing the normal approval workflow, while all posting validation still runs?

**Method:** End-to-end test against the live database (Supabase project
`zqgjkefoxbkygtblwrfc`), impersonating real users via `request.jwt.claims`,
posting a real balanced draft entry through the production posting trigger, then
rolling the whole transaction back (no data mutated).

**Result:**

| Check | Outcome |
|-------|---------|
| `core.is_admin()` for a user with a system (Administrator) role | `true` |
| `core.is_admin()` for a non-admin in the same company | `false` |
| `core.user_has_permission('pk_rent_invoice','post')` for the admin | `true` |
| Journal entry status transition | `draft → posted` |
| `posted_by` after posting | equals the admin's uid (correct attribution) |

**What it confirms:**

1. `core.is_admin()` is correct — auto-post fires *only* for admins (system role
   in the active company).
2. The admin's post genuinely succeeds through
   `accounting.fn_enforce_balanced_entry`, which independently re-checks post
   permission **and** debit = credit balance before allowing the transition.
   Posting is never a blind status flip.
3. `posted_by` is stamped to the admin's own uid, so the audit trail is intact.

**Wiring is uniform** — the `isCurrentUserAdmin() → post…()` auto-post block is
present in all 9 create actions:

- `features/accounting/vouchers/{receipt,payment,journal,pdc-receipt,pdc-payment,cheque-return,jv-maintenance,opening-balance}/actions.ts`
- `features/assets/sale/actions.ts`

**Safety properties:**

- Non-admins are unaffected — they still create drafts routed through the normal
  approval workflow.
- The balanced-entry trigger gates every post, so an admin can never auto-post an
  unbalanced or empty entry — it raises and the draft remains for correction.
- Auto-post in the create actions is wrapped in `try/catch`, so a failed
  auto-post never breaks voucher creation.

**Not covered by this test:** the browser round-trip (session cookie → server
action). Recommended manual check: create one voucher in the UI while logged in
as an Administrator and confirm it lands on the **posted** list rather than
**pending**.

**Relevant migrations:** `0047_is_admin_helper.sql` (`core.is_admin`),
`0004_accounting_engine.sql` (`fn_enforce_balanced_entry`).
