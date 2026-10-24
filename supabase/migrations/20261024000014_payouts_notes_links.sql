-- 14: tutor payouts + adjustments, student notes, meeting-link RPC, enrollment status guard,
--     completion sync, and three more admin settings. Purely additive; no existing rows are changed.
-- Apply with the session pooler (same way as migrations 1-13) and record the file name in public.schema_migrations.

-- ---------------------------------------------------------------- payouts
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  status text not null default 'finalized' check (status in ('finalized', 'paid')),
  item_count integer not null check (item_count >= 0),
  items_total numeric(12,2) not null,
  adjustments_total numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  currency text not null default 'INR',
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  pay_method text,
  pay_reference text,
  unique (teacher_id, period_month)
);

create table if not exists public.payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount <> 0),
  reason text not null check (length(trim(reason)) > 0),
  related_payout_id uuid references public.payouts(id),
  applied_payout_id uuid references public.payouts(id),
  recorded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.earning_items
  add constraint earning_items_payout_fk foreign key (payout_id) references public.payouts(id);

alter table public.payouts enable row level security;
alter table public.payout_adjustments enable row level security;

create policy payouts_finance_read on public.payouts for select using (public.has_admin_permission('finance'));
create policy payouts_teacher_read on public.payouts for select using (teacher_id = auth.uid() and public.is_approved_teacher());
create policy payout_adj_finance_read on public.payout_adjustments for select using (public.has_admin_permission('finance'));
create policy payout_adj_teacher_read on public.payout_adjustments for select using (teacher_id = auth.uid() and public.is_approved_teacher());
-- no insert/update/delete policies: every write goes through the functions below

-- a finalized payout can only move finalized -> paid; its amounts are frozen; it can never be deleted
create or replace function public.guard_payout_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payouts cannot be deleted; record an adjustment instead.'; end if;
  if (new.teacher_id, new.period_month, new.item_count, new.items_total, new.adjustments_total, new.total, new.currency, new.finalized_by, new.finalized_at)
     is distinct from (old.teacher_id, old.period_month, old.item_count, old.items_total, old.adjustments_total, old.total, old.currency, old.finalized_by, old.finalized_at) then
    raise exception 'A finalized payout cannot be edited; record an adjustment instead.';
  end if;
  if old.status = 'paid' and new.status <> 'paid' then raise exception 'A paid payout cannot be reopened.'; end if;
  return new;
end $$;
create trigger payouts_guard before update or delete on public.payouts for each row execute function public.guard_payout_update();

create trigger payouts_audit after insert or update or delete on public.payouts for each row execute function public.audit_generic();
create trigger payout_adjustments_audit after insert or update or delete on public.payout_adjustments for each row execute function public.audit_generic();
create trigger payout_adjustments_immutable before update or delete on public.payout_adjustments for each row execute function public.prevent_change();

-- finalized earning items are frozen (their attendance is locked)
create or replace function public.guard_finalized_earning() returns trigger language plpgsql as $$
begin
  if old.payout_id is not null then raise exception 'This earning belongs to a finalized payout and cannot change; record an adjustment instead.'; end if;
  return coalesce(new, old);
end $$;
create trigger earning_items_finalized_guard before update or delete on public.earning_items for each row execute function public.guard_finalized_earning();

-- attendance for a month a tutor's payout was finalized is locked, even for sessions that earned nothing
create or replace function public.guard_locked_attendance() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sessions s join public.payouts p on p.teacher_id = s.teacher_id
             where s.id = coalesce(new.session_id, old.session_id)
               and p.period_month = date_trunc('month', s.start_at at time zone 'Asia/Kolkata')::date) then
    raise exception 'This attendance is locked because its payout was finalized.';
  end if;
  return coalesce(new, old);
end $$;
create trigger session_participants_lock before update of attendance, absence_reason on public.session_participants for each row execute function public.guard_locked_attendance();

create or replace function public.finalize_payout(p_teacher uuid, p_month date) returns uuid
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; n integer; norate integer; unmarked integer; items numeric; adj numeric; pid uuid;
begin
  if not public.has_admin_permission('finance') then raise exception 'Only Finance can finalize payouts.'; end if;
  if m >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date + interval '1 month' then raise exception 'That month has not started yet.'; end if;
  if exists (select 1 from public.payouts where teacher_id = p_teacher and period_month = m) then raise exception 'This month is already finalized for this tutor.'; end if;
  select count(*) into unmarked from public.session_participants sp join public.sessions s on s.id = sp.session_id
   where s.teacher_id = p_teacher and s.status = 'scheduled' and s.end_at < now()
     and date_trunc('month', s.start_at at time zone 'Asia/Kolkata')::date = m and sp.attendance = 'unmarked';
  if unmarked > 0 then raise exception '% class(es) in this month still need attendance. Resolve them before finalizing.', unmarked; end if;
  select count(*), count(*) filter (where rate_snapshot is null), coalesce(sum(rate_snapshot), 0) into n, norate, items
    from public.earning_items where teacher_id = p_teacher and payout_id is null and date_trunc('month', earned_on)::date = m;
  if norate > 0 then raise exception '% earning(s) have no rate. Set the tutor rate and apply it first.', norate; end if;
  select coalesce(sum(amount), 0) into adj from public.payout_adjustments where teacher_id = p_teacher and applied_payout_id is null;
  if n = 0 and adj = 0 then raise exception 'Nothing to finalize for this tutor and month.'; end if;
  insert into public.payouts (teacher_id, period_month, item_count, items_total, adjustments_total, total, finalized_by)
  values (p_teacher, m, n, items, adj, items + adj, auth.uid()) returning id into pid;
  update public.earning_items set payout_id = pid where teacher_id = p_teacher and payout_id is null and date_trunc('month', earned_on)::date = m;
  update public.payout_adjustments set applied_payout_id = pid where teacher_id = p_teacher and applied_payout_id is null;
  return pid;
end $$;

create or replace function public.mark_payout_paid(p_payout uuid, p_method text, p_reference text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_admin_permission('finance') then raise exception 'Only Finance can mark a payout paid.'; end if;
  if coalesce(trim(p_method), '') = '' then raise exception 'Choose how it was paid.'; end if;
  update public.payouts set status = 'paid', paid_at = now(), paid_by = auth.uid(), pay_method = trim(p_method), pay_reference = nullif(trim(p_reference), '')
   where id = p_payout and status = 'finalized';
  if not found then raise exception 'This payout is not awaiting payment.'; end if;
end $$;

create or replace function public.add_payout_adjustment(p_teacher uuid, p_amount numeric, p_reason text, p_related uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.has_admin_permission('finance') then raise exception 'Only Finance can record payout adjustments.'; end if;
  if not exists (select 1 from public.teacher_profiles where user_id = p_teacher) then raise exception 'Tutor not found.'; end if;
  insert into public.payout_adjustments (teacher_id, amount, reason, related_payout_id) values (p_teacher, p_amount, p_reason, p_related) returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------- student notes
create table if not exists public.student_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_at timestamptz not null default now()
);
alter table public.student_notes enable row level security;
create policy student_notes_read on public.student_notes for select using (public.is_admin() or public.teacher_sees_student(student_id));
create policy student_notes_insert on public.student_notes for insert
  with check (author_id = auth.uid() and (public.has_admin_permission('coordinator') or public.teacher_sees_student(student_id)));
create trigger student_notes_immutable before update or delete on public.student_notes for each row execute function public.prevent_change();
create trigger student_notes_audit after insert on public.student_notes for each row execute function public.audit_generic();

-- ---------------------------------------------------------------- meeting links (teachers cannot update sessions directly)
create or replace function public.set_meeting_link(p_session uuid, p_link text, p_all_upcoming boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare s public.sessions; n integer; enr uuid[];
begin
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'Class not found.'; end if;
  if not (public.has_admin_permission('coordinator') or (auth.uid() = s.teacher_id and public.is_approved_teacher())) then
    raise exception 'You are not allowed to change this class.';
  end if;
  if p_link !~* '^https?://\S+$' or length(p_link) > 500 then raise exception 'Enter a full link starting with https://'; end if;
  select array_agg(enrollment_id) into enr from public.session_participants where session_id = p_session;
  update public.sessions set meeting_link = trim(p_link) where id = p_session;
  n := 1;
  if p_all_upcoming then
    update public.sessions x set meeting_link = trim(p_link)
     where x.teacher_id = s.teacher_id and x.status = 'scheduled' and x.start_at > now() and x.id <> p_session
       and exists (select 1 from public.session_participants sp where sp.session_id = x.id and sp.enrollment_id = any (enr));
    get diagnostics n = row_count; n := n + 1;
    update public.enrollments set meeting_link = trim(p_link) where id = any (enr) and primary_teacher_id = s.teacher_id;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- enrollment status integrity
create or replace function public.guard_enrollment_status() returns trigger language plpgsql security definer set search_path = public as $$
declare owed integer;
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status in ('completed', 'withdrawn') then raise exception 'A closed course cannot be reopened.'; end if;
  if new.status = 'completed' then
    select (coalesce((select sum(quantity) from public.credit_movements where enrollment_id = new.id), 0)
          - (select count(*) from public.session_participants sp join public.sessions s on s.id = sp.session_id
              where sp.enrollment_id = new.id and s.status = 'completed' and sp.attendance = 'present'))::integer into owed;
    if owed > 0 then raise exception 'Cannot complete: % allocated class(es) are not yet delivered. Withdraw with a settlement instead.', owed; end if;
  end if;
  return new;
end $$;
create trigger enrollments_status_guard before update of status on public.enrollments for each row execute function public.guard_enrollment_status();

create or replace function public.sync_enrollment_completion() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.enrollments e set status = 'pending_completion'
   where e.status = 'active' and e.term_end is not null and e.term_end < (now() at time zone 'Asia/Kolkata')::date
     and (coalesce((select sum(quantity) from public.credit_movements where enrollment_id = e.id), 0)
          - (select count(*) from public.session_participants sp join public.sessions s on s.id = sp.session_id
              where sp.enrollment_id = e.id and s.status = 'completed' and sp.attendance = 'present')) > 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- settings that the app actually reads
insert into public.setting_definitions (key, grp, label, help, type, default_value, min_value, max_value, options, unit, requires_reason, edit_permission) values
 ('org.business_name', 'Organization', 'Business name', 'Shown in the sidebar header. Branding colours and the logo are part of the app build.', 'text', '"Mitrin The Language School"', null, null, null, null, true, 'super_admin'),
 ('schedule.slot_step_minutes', 'Classes & scheduling', 'Time picker step', 'Minutes between choices in class time pickers.', 'enum', '15', null, null, '[5,10,15,30]', 'minutes', true, 'super_admin'),
 ('tutor.availability_confirm_day', 'Availability', 'Day tutors are reminded to confirm next week', 'From this weekday the tutor Home screen highlights Confirm Next Week.', 'enum', '"Thursday"', null, null, '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]', null, true, 'super_admin')
on conflict (key) do nothing;
