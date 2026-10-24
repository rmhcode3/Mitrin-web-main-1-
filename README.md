# MITRIN — Tutor Management OS

Operations platform for Mitrin The Language School: enquiries → demos → enrollment → class credits → scheduling → attendance → fees → tutor payouts. React + Vite + TypeScript + Tailwind on **Supabase** (Auth, Postgres, Row Level Security).

Business rules come from `MITRIN_Tutor_Management_OS_PRD_Claude_v1.1.md`. What is built, partial or missing is listed requirement by requirement in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

## Run it locally (VS Code)

```bash
npm install
cp .env.example .env      # then fill in your Supabase URL + anon key (+ DATABASE_URL_SESSION for the db scripts)
npm run dev               # http://localhost:5173
```

Sign in with an existing account of the Supabase project. Roles come from the database:

| Account type | `profiles.role` | `profiles.admin_permissions` | Lands on |
|---|---|---|---|
| Super Admin | `admin` | `super_admin` | `/admin` (everything) |
| Coordinator | `admin` | `coordinator` | `/admin` (no fees / payouts) |
| Finance | `admin` | `finance` | `/admin` (no scheduling) |
| Tutor | `teacher` | — | `/tutor` (after approval) |

Tutors register themselves at `/register` and stay on a "pending approval" screen until a coordinator approves them. Staff are invited by a Super Admin (Team accounts → Invite staff, needs the edge function below).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server / production build / serve the build |
| `npm run typecheck` / `lint` | TypeScript and oxlint |
| `npm test` | Unit + component tests (Vitest) |
| `npm run test:db` | 18+ backend scenarios against the real database **inside a rolled-back transaction** (nothing is saved) |
| `npm run test:db:pre014` | Same, plus first applies migration 14 inside the transaction to prove it before deployment |
| `node tests/e2e/smoke.mjs` | Browser smoke test in Chrome (desktop + phone size) after `npm run build`; set `SHOTS=dir` for screenshots |
| `npm run db:check` | Read-only connection check |
| `npm run db:seed` | Dev-only sample enquiries (needs `ALLOW_DEV_SEED=true`) |

## Database

The Supabase project already contains migrations 1–13 (tables, RLS, RPCs). **Do not re-run them.** This repo adds one more file, applied by a person who manages the project:

- `supabase/migrations/20261024000014_payouts_notes_links.sql` — payouts + adjustments, student notes, meeting-link RPC, status guards. Apply it the same way as migrations 1–13 (session pooler, then record its name in `public.schema_migrations`). Prove it first with `npm run test:db:pre014`.
- `supabase/functions/invite-staff` — `supabase functions deploy invite-staff`. Uses the project's own service-role key on the server only.

Security notes: only the public anon key is in the browser; every read and write goes through RLS or `SECURITY DEFINER` functions; the service-role key and DB password never ship to the client. `public.schema_migrations` has RLS off (pre-existing) — consider enabling it.

## Deploy (Vercel)

Build command `npm run build`, output `dist`, environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `vercel.json` already rewrites all paths to `index.html`. In Supabase → Authentication → URL configuration add your site URL and `/reset-password` for password-reset emails.

Pre-launch checklist: apply migration 14 and the edge function · turn **off** the setting “Allow a demo result before its booked time” (it is on for testing) · confirm backups/PITR on the Supabase plan · privacy review for minors’ data · decide MFA for privileged accounts (Supabase dashboard).

## Project map

```
src/
  App.tsx, main.tsx          routes, guards, providers
  lib/                       supabase client, auth (roles), api helpers, time-zone + format helpers, CSV/XLSX export
  components/                design system (ui.tsx), shell/navigation, scheduling (calendar, attendance, class forms), demo scheduler
  pages/admin/               Dashboard, Leads, Demos, Students (+drawer), Teachers, AvailabilityMatrix, SlotFinder, Scheduler,
                             Attendance, Fees, Payouts, Reports, Team, Imports, Audit, Settings
  pages/tutor/               Home, Classes, Attendance, Students, Earnings, Availability & leave, Profile
  pages/auth/                Sign in, tutor registration, password reset, approval gate
supabase/migrations/         SQL (014 is new, not yet deployed)   supabase/functions/   edge functions
tests/                       db-scenarios.mjs, e2e/
```

## Time zones

Classes are stored as exact UTC instants. Screens show times in the viewer’s chosen zone with the zone abbreviation, and the slot finder / demo scheduler show the tutor’s local time next to the learner’s. DST is covered by tests.
