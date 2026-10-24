# CHANGES

## 2026-10-24

### Sidebar active item uses blue
**Commit:** Uncommitted
- **Changed:** `src/components/Shell.tsx` — sidebar/mobile header navy changed to deeper logo blue `#0a2351`; "Log out" (and teacher "Profile") are now compact icon buttons beside the user name instead of full-width buttons. Active item stays orange.
- **Changed:** `src/components/Shell.tsx` — sidebar logo lockup: emblem only (cropped from `mitrin-logo.webp`, no white box), large white "MITRIN" and small light-blue "THE LANGUAGE SCHOOL" beside it. No longer reads the `org.business_name` setting there.
- **Changed:** `src/index.css` — added `navy` / `navy-700` theme colors (`#0a2351` / `#061737`).
- **Changed:** `src/components/ui.tsx`, `src/components/scheduling.tsx`, `src/pages/admin/Leads.tsx` — dark buttons (Add lead, active Kanban/Roster and Day/Week/Month toggles) use navy instead of brown-black.
- **Changed:** `src/pages/auth/AuthPages.tsx` — `AuthFrame` (login, reset password, apply to teach) is now a split layout: navy gradient brand panel (logo, tagline, footer; desktop only) beside a rounded white form card.
- **Changed:** `public/assets/mitrin-mark.png` — emblem now has the white book fill (made transparent-background from the supplied icon); used in sidebar, login panel and mobile bar.
- **Changed:** `public/favicon.png` — replaced with the new emblem-on-navy icon supplied by the user.
- **Changed:** `src/index.css` — Tailwind weight tokens lowered one step app-wide (`semibold` 500, `bold` 600, `extrabold` 700) so text is lighter.
- **Changed:** `src/pages/admin/Leads.tsx` — kanban card stage picker is now a custom popover menu (`StageMenu`, "Move stage" header, rounded white card, selected stage highlighted) instead of a native `<select>`.
- **Changed:** `tests/e2e/smoke.mjs` — stage change step uses the new menu (click + menuitem) instead of `selectOption`.
- **Changed:** `src/components/Shell.tsx` — shell wrapper `h-full` → `min-h-full` so the sticky sidebar stays pinned while long pages scroll (it was scrolling away with the page).
- **Changed:** `index.html`, `src/index.css` — app font set to Plus Jakarta Sans (Google Fonts; replaces Poppins), matching the login reference.
- **Changed:** `src/index.css`, `src/components/ui.tsx`, `src/pages/auth/AuthPages.tsx` — text fields no longer get the global orange focus outline on top of their own border/ring (double border); added an orange hover border.
- **Changed:** `src/pages/auth/AuthPages.tsx` — login form restyled: icon inputs (mail/lock), "Required" label, show/hide password, right-aligned "Forgot password?", gradient "Sign in →" button, divider + "Apply to teach" link.
- **Changed:** `src/index.css` — added `.scroll-side` (4px, transparent track, subtle thumb); used by the sidebar nav in `Shell.tsx` instead of `scroll-thin`.
- **Changed:** `src/components/Shell.tsx` — active sidebar link is MITRIN orange again (was indigo `#6366f1`); sidebar and mobile header dark background changed from brown `#241f1a` to navy `#0f172a`.

### Frontend application built on the existing Supabase backend (migrations 1-13 untouched)
**Commit:** Uncommitted (the folder is not a git repository yet)
- **Added:** whole React 19 + Vite + TypeScript + Tailwind v4 app under `src/` (see README for the map): auth and role routing, 17 admin screens, 7 tutor screens, shared design system (`src/components/ui.tsx`), scheduling components (`src/components/scheduling.tsx`), error boundary.
- **Added:** `vercel.json` — SPA rewrite so deep links work on Vercel.
- **Added:** `public/assets/mitrin-logo.webp`, `public/favicon.png` — downloaded unmodified from mitrinschool.com.
- **Added:** `package.json` scripts `test`, `test:db`, `test:db:pre014`, `typecheck`, `db:check`, `db:seed`.
- **Added:** `tests/db-scenarios.mjs` — 25 backend acceptance scenarios (RLS, RPCs, ledgers), run inside a transaction that is always rolled back.
- **Added:** `tests/e2e/` — browser smoke test (Chrome, desktop + phone size) with intercepted network fixtures.
- **Added:** `src/**/*.test.ts(x)` — unit/component tests (time zones/DST, CSV, attendance marker, responsive table).
- **Added:** `scripts/seed-dev.mjs` (dev-only, guarded), `scripts/db*.mjs` (read-only inspection helpers).
- **Added:** `CLAUDE.md`, `README.md`, `docs/REQUIREMENTS.md`, `.env.example`, `.gitignore`.
- **Added:** `supabase/migrations/20261024000014_payouts_notes_links.sql` — payouts + payout adjustments (finalize locks attendance, immutable), student notes, `set_meeting_link`, enrollment status guard, `sync_enrollment_completion`, 3 new settings ⚠ DEPLOY
- **Added:** `supabase/functions/invite-staff/` — lets a Super Admin create Coordinator/Finance/Super Admin accounts server-side ⚠ DEPLOY

Until the two ⚠ DEPLOY items are applied, these screens show a clear "needs a database update" message instead of failing: payout finalization / mark paid / adjustments, student notes, adding or changing a meeting link on a class that is already booked (a link given while booking works today), staff invites, and the completion/status guards. Everything else works against the current database.
