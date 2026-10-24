# Requirement checklist (PRD v1.1 → implementation)

Status key: **Built** = implemented and exercised · **Partial** = works, with the gap stated · **Not built** = not in this delivery · **P2/EXT** = needs a verified external service.
"DB-tested" means proven by `npm run test:db` against the real database (rolled back). "Browser-checked" means rendered and clicked in Chrome with intercepted network data (`tests/e2e/smoke.mjs`); it is **not** a live login. Items needing migration 14 are marked ⚠014.

## Modules

| PRD | Requirement | Status | Where / notes |
|---|---|---|---|
| FR-001/002 | Tutor self-registration, pending approval, access only after approval | Built, DB-tested (AT-05) | `pages/auth/AuthPages.tsx`; approval in `Teachers.tsx`. Weekly hours are set *after* approval (RLS only lets approved tutors write them). |
| FR-003/004 | Distinct roles; suspend account | Built | `lib/auth.tsx`, `Teachers.tsx`, `Team.tsx` |
| FR-005 | Password recovery, MFA | Partial | Reset-by-email built (`/reset-password`). MFA is a Supabase dashboard setting, not wired. |
| FR-010/011/014 | Enquirer ≠ learner; several courses per learner | Built | `Leads.tsx`, `Students.tsx` (one row per enrollment; “Add another course”). Siblings with one phone are allowed. |
| FR-012/013 | Organization payer, contract-level billing | **Not built** | No organization table exists. Needs a migration + UI. |
| FR-020/022/023 | Manual leads, stages, conversion without duplicates | Built | `Leads.tsx` (kanban + roster, filters, duplicate warning, `convert_lead`) |
| FR-021/024 | Runo two-way sync | **EXT** | Not implemented; no invented endpoints. Manual flow works fully. Imports dedupe by learner+phone for review only. |
| FR-030–034 | Demos: finder, tutor acceptance, outcomes, second demo, no credit/payout | Built | `DemoScheduler.tsx`, `Demos.tsx`, drawer in `Leads.tsx` |
| FR-040–042, 044–045 | Weekly hours, next-week prefill, confirm, matrix, finder, time zones | Built | `TutorAvailability.tsx`, `AvailabilityMatrix.tsx`, `SlotFinder.tsx` |
| FR-043/046 | Outside-hours teaching; tentative ≠ booked | Built | Tutors may book any time; finder labels Confirmed / Tentative. |
| FR-044 | One-off *extra* free slots | Partial | Exceptions can only remove time; there is no “add one-off hours”. |
| FR-050/051/053/054/055 | Enrollment, tutor accept/decline, credit allocation, extend / new related, Pending Completion | Built | `StudentDrawer.tsx`; completion guard + auto Pending Completion ⚠014 |
| FR-052 | Additional tutors on one enrollment | **Not built** | Schema has one primary tutor. |
| FR-056 | Coordinator sets up teaching, Finance sets fees | Built | Fee plans only in Finance screens |
| FR-060–062 | Group classes, tutor-owned groups, moving learners between groups | Partial | Group = one shared session with several learners (each with own credit/attendance). No persistent “group” entity, so no temporary/permanent group moves. |
| FR-063 | Reschedule: one / all future / selected learners | Partial | “Only this class” and “this and future” built; “selected learners” not supported by the existing RPCs. |
| FR-064/065 | Overlap checks; recurring plans limited by credits | Built, DB-tested | `schedule_session`, `schedule_series` |
| FR-066 | Meeting links | Built / ⚠014 | Link at booking works now; editing an existing class’s link needs `set_meeting_link` ⚠014 |
| FR-067/068 | Makeup/extra only against credits; change history | Built | `SessionPanel` shows old→new, reason, who |
| FR-070–076 | Attendance, makeup, leave, edit until payout, lock after, Save & Next | Built, DB-tested | `TutorAttendance.tsx`, lock + adjustments ⚠014 |
| FR-072 | Leave makes affected classes pending automatically | Partial | Leave blocks new bookings and flags conflicts; booked classes are not auto-cancelled (coordinator reassigns / tutor reschedules). |
| FR-077, 130–134 | WhatsApp confirmations, receipts, certificates | **P2/EXT** | Shown disabled in Settings. Nothing is sent. |
| FR-080–086 | Credit ledger, holds, friendly balances | Built, DB-tested | Credits tab, hold/release in `Fees.tsx` |
| FR-090–094, 097 | Fee plans, installments, manual payments, refunds/waivers/adjustments | Built, DB-tested | `Fees.tsx` |
| FR-092 | Mid-month proration | Partial | Finance enters custom installments; later change is an adjustment. No auto-calculation from remaining planned classes. |
| FR-095 | Foreign payments with manual INR | Built, DB-tested | Payment modal |
| FR-096 | Tutors/coordinators never see fee amounts | Built, DB-tested (AT-24) | RLS + UI |
| FR-100–105 | Rates, earnings per attending learner, finalize, paid, tutor view | Built / ⚠014 for finalize, paid | `Payouts.tsx`, `TutorEarnings.tsx` |
| FR-106 | Closing settlement | Built ⚠014 | Payout adjustment |
| FR-110–114 | Statuses, withdrawal with settlement, hold scope | Built / Partial | Withdrawal records reason + settlement in the student notes line; no structured settlement record. |
| FR-120–125 | Five report families, date filters, CSV/XLSX, permission-scoped | Built | `Reports.tsx`, `ExportMenu` |
| FR-126 | Task lists instead of chart-heavy dashboards | Built | `Dashboard.tsx` |
| FR-140–146 | Settings control center | Partial | See below |

## Settings (PRD §16)

| Built and wired | Not built |
|---|---|
| Searchable, grouped settings with typed validation (server + client), default / customised, version locking, required reason, diff before save, restore default, per-setting history + rollback, role-restricted edit (Super Admin vs delegated Finance) | Draft → publish workflow, scheduled effective dates, impact counts |
| 13 settings that code actually reads (class length, repeat weeks, back-booking window, leave blocking, low-credit and ageing thresholds, demo follow-up, fee due day, overdue days, early demo outcome, business name ⚠014, time-picker step ⚠014, confirm-reminder day ⚠014) | Custom-field engine, report column presets / saved views |
| Languages catalog (add / archive) | Editable levels, age bands, lead sources, reason catalogs, status labels, terminology |
| Protected rules list (read-only), roles matrix, connections status (Runo / WhatsApp / Meet shown honestly as not enabled), health check + DST diagnostic | Permission-matrix editor, notification routing / templates / quiet hours, feature-flag registry |
| Settings export / import with preview (values only, no secrets) | Backup schedule UI (managed by Supabase), data-retention scheduling |

## Acceptance tests

| Test | Status |
|---|---|
| AT-01 two learners, separate credits | Built (separate enrollments/ledgers) |
| AT-02 school with 20 learners under one contract | **Not built** (organizations) |
| AT-03/04 demo decline/reallocate, no-shows, second demo | Built (existing RPCs + UI); not in the scenario suite |
| AT-05 tutor restricted until approved | **DB-tested**, browser-checked |
| AT-06/07 availability prefill, exceptions, finder | Built; browser-checked |
| AT-08 group class, per-learner credit | **DB-tested** |
| AT-09/10 move learner between groups | **Not built** |
| AT-11 booking beyond credits blocked | **DB-tested** |
| AT-12 absent learner keeps class, others earn | **DB-tested** |
| AT-13 emergency leave → pending, substitute | Partial (reassign + cancel→makeup **DB-tested**; no auto-pending on leave) |
| AT-14 makeup by substitute earns in delivery month | **DB-tested** |
| AT-15/16 finalize locks attendance; correction by adjustment | **DB-tested** with migration 14 (⚠014) |
| AT-17/18 hold removes one learner; release does not revive | **DB-tested** |
| AT-19 mid-month fee + adjustment | Partial (manual) |
| AT-20 prepaid installments not charged again | **DB-tested** |
| AT-21 foreign payment, manual INR | **DB-tested** |
| AT-22 Pending Completion | **DB-tested** with migration 14 (⚠014) |
| AT-23 withdrawal with settlement | Partial |
| AT-24 role boundaries | **DB-tested**, browser-checked |
| AT-25 report filters + exports | Built; CSV logic unit-tested; file download not automated |
| AT-26 import reconciliation | Partial (enquiries and students + opening credits, dry run, total check; no fee / assignment imports) |
| AT-27 works without Runo | Built (manual flow is the only flow) |
| AT-28 DST across overseas learner / India tutor | **Unit-tested** (`format.test.ts`) |
| SET-AT-01/03/11/12/16 | Built, browser-checked (validation, reason, diff, export, import preview; rollback UI built, DB history table) |
| SET-AT-02/13/15 | **DB-tested** (role limits, last Super Admin, version conflict) |
| SET-AT-04/05/06/07/08/09/14 | Not applicable or **Not built** (per-course defaults, custom fields, permission editor, Runo) |
| SET-AT-10 WhatsApp flag cannot activate | Built (control is disabled; nothing to activate) |

## Known limits of this delivery

- Authenticated screens were exercised with intercepted network data, not a live sign-in (no passwords were available). Live behaviour of the backend rules is covered by the rolled-back DB scenarios.
- Phone layouts were verified in Chrome device emulation, not on physical phones.
- No load test has been run (PRD target 500 students / 200 tutors).
- The main JS chunk is ~630 kB (≈185 kB gzipped); screens are lazy-loaded.
