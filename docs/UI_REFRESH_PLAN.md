# UI and local cache revision — 21 September 2026

Basis: production-buy-more-final.zip (user confirmed). Update the existing React 18/Vite 5/Tailwind 3 application; no new database/service, no change to SQL/Edge permissions. This revision supersedes the old visual fingerprint requirement only for the explicitly requested UI changes.

## Design
- One light interface; remove the theme switch and decorative emoji. Preserve the B/BUYMORE identity, existing primary blue, neutral backgrounds, and business workflows.
- Left, text-only navigation with hide/show on desktop and modal drawer on small screens. Native dialog focus management, Escape dismissal, return focus, and visible text controls.
- One readable text size per viewport (14px desktop, 16px small screens), excluding brand text. Consistent field/button/table spacing. Data tables become labelled records on small screens, retaining all cells/actions.
- Section descriptions and always-on realtime/presence indicators removed. Required field labels, errors, reasons, offline-unsaved work, and security instructions remain.
- Query-result cache integrated through the existing Supabase client transport. Only allowlisted reads; never cache a mutation, auth credential, signed URL, MFA secret, or export snapshot. Bounded per-tab sessionStorage data cache; memory-only user directory; user/factory/role/AAL/revision isolation; TTL, authorization lease, mutation/realtime invalidation. No alternate/mock runtime database.
- Page preferences (filters, selected tabs, pagination) stored per validated scope. Security screens cache only presentation preferences; Auth/MFA/permission checks always go to Supabase.

## Execution and verification
1. [x] Inspect existing root, pages, Supabase transport, API contracts, styles, service worker, and baseline tests.
2. [x] Write failing cache tests; implement pure typed cache and cached fetch; retain successful mutation confirmation semantics.
3. [x] Implement shared shell/dialog/table presentation and adapt existing main.tsx; preserve bilingual labels, routes, actions and form fields.
4. [x] Integrate scope lifecycle, permission refresh, cached page preferences and invalidation.
5. [x] Run existing + new tests, source syntax/import checks, full typecheck/build where dependencies can be installed, browser checks where runtime is available.
6. [x] Package source and a changed-files ZIP, current QA report and upgrade instructions. Record real failures, not invented passes.

## Review focus
- Account/Factory/role change must never display another scope's cached data.
- Rejected/failed writes cannot produce cached success; exports always fetch live snapshot pages.
- Aborted old requests cannot repopulate a cache after logout or invalidation.
- Every mobile record keeps its label and all actions, including correction and verification.
- Modal keyboard behavior, names and touch target sizes remain usable at 360px and with zoom.

Execution evidence: 78 tests passed; 46 isolated component browser checks passed; full typecheck/build attempted and failed because dependencies are unavailable. Source syntax checks are not full compilation. Final QA records this limitation.
