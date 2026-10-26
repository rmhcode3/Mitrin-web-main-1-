# CHANGES

## 2026-10-26

### Class format column in Leads roster
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/Leads.tsx` — new "Class format" column (Individual / Group / Either) in the Roster table and in the CSV/Excel export; coordinators can change it inline at any stage, including Converted and Lost.

## 2026-10-24

### Enrollment: hints for Awaiting tutor status
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/StudentDrawer.tsx` — hints in Course & teacher when no tutor is assigned or the tutor has not accepted yet
- **Changed:** `src/pages/admin/StudentDrawer.tsx` — new "Course information" box (shown once classes are allocated): course, allocated/booked/delivered/remaining, allocation lines, and class timings (upcoming booked classes) once the tutor has accepted..

### Demo scheduler: contact tutors who are not free
**Commit:** Uncommitted
- **Changed:** `src/components/DemoScheduler.tsx` — "Other Tutors" column has a note and a "Contact on WhatsApp" link per tutor (prefilled request for the chosen date/time, IST) so the admin can ask non-available tutors to cover.

### Availability matrix: single-tutor view modelled on the reference page
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/AvailabilityMatrix.tsx` — new Tutor dropdown; picking a tutor shows usual weekly hours by weekday, upcoming blocked dates, leave periods and an availability conflict tester (checks leave, exceptions and usual hours) above the grid, which is filtered to that tutor. Read-only; no database change.

### Teacher roster: layout modelled on the reference Teachers page
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/Teachers.tsx` — summary strip (active tutors, on leave today, languages covered); search + availability dropdown (All / Available / On leave today) in one bar; cards get a "Joined date / View profile →" footer; 9 cards per page with "Showing x to y of N tutors" and Previous/Next.

### Date range filter (Leads, Demos, Enrollment, Availability matrix) and Excel-style tables
**Commit:** Uncommitted
- **Added:** `src/components/DateRange.tsx` — `useDateRange` + `DateRangeFilter` dropdown (All, Yesterday, Today, This Week, This Month, Custom with from/to dates); India time; the selected range is shown beside the dropdown.
- **Changed:** `src/pages/admin/Leads.tsx` (created date; replaces the old Created from/to fields), `Demos.tsx` (demo date; bordered table), `Students.tsx` (enrollment created date) — dropdown above the table.
- **Changed:** `src/pages/admin/AvailabilityMatrix.tsx` — week prev/next buttons replaced by the dropdown; columns follow the range (All = 4 weeks from this Monday, custom capped at 62 days); bordered Excel-style table.

### Leads and Demos polish
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/Leads.tsx` — Stage dropdown in Roster is colour-coded like the badges; new derived stage "Demo Accepted" (a Demo Scheduled lead whose tutor accepted the demo; no DB change); Reschedule/Cancel/no-show demo buttons are orange.
- **Changed:** `src/components/DemoScheduler.tsx` — past dates disabled, start time labelled India time (IST) and cannot be earlier than now when date is today; Find available tutors is orange.
- **Changed:** `src/components/ui.tsx`, `src/components/scheduling.tsx` — new `teal` tone, `toneClass` helper.
- **Changed:** `src/pages/admin/Demos.tsx` — "All" tab is first.

### Enrollment page (was Student roster)
**Commit:** Uncommitted
- **Changed:** `src/components/Shell.tsx`, `src/pages/admin/Students.tsx` — "Student roster" renamed "Enrollment"; list uses the gridlines table.
- **Changed:** `src/components/ui.tsx` — `DataTable` gets optional `grid` prop (bordered, spreadsheet look).
- **Changed:** `src/pages/admin/StudentDrawer.tsx` — Overview is now an inline editable form (lead + course details, Save changes) instead of the Edit modal; "Learner & contact" renamed "Lead"; learner time zone removed from the box and form.

### Demos & trials: WhatsApp button
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/Demos.tsx` — new "WhatsApp" column after Actions with a "Send via WhatsApp" button that opens wa.me with a prefilled demo message (date/time IST, tutor, meeting link).

### Demos & trials: action dropdown, new filter tabs
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/Demos.tsx` — "Details" column renamed "Meeting Link" (decline reason/outcome moved under Status); Actions is now one dropdown (Reschedule/Reassign, Completed, No-show, Enrolled, Dropped, Cancel); Enrolled runs `convert_lead`, Dropped runs `close_leads`; top tabs now Awaiting tutor, Accepted, Rescheduled, Completed, Enrolled, Dropped, All.

### Lead drawer editable, demo scheduler simplified
**Commit:** Uncommitted
- **Changed:** `src/pages/admin/Leads.tsx` — Leads opens in Roster view by default; the lead side panel's Requirements section is now an inline editable form with Save changes (admins/coordinators, open leads only); the separate follow-up notes box is hidden then because notes are in the form.
- **Changed:** `src/components/DemoScheduler.tsx` — removed Length and "Times are in" fields (fixed 30 min, Asia/Kolkata); tutor list split into "Available Tutors" (confirmed/tentative) and "Other Tutors" (everyone else).

### Leads page and Add lead form changes
**Commit:** Uncommitted
- **Changed:** `src/components/Shell.tsx` — sidebar item "Leads pipeline" renamed to "Leads".
- **Changed:** `src/pages/admin/Leads.tsx` — page title "Leads"; Roster view is now a bordered spreadsheet-style table with a Stage dropdown per row (moves the lead via the existing stage logic).
- **Changed:** `src/pages/admin/Leads.tsx` — Add lead form: "Lead Name" (also saved as learner name), Learner name / Preferred timing / Time zone fields removed, Age is a typed number (required), "Individual or group" renamed "Class format", footer is Cancel + Create Lead (Save & schedule demo removed).


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
