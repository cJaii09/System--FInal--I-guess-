-- Phase 4 safeguards. request_events remains the recipient-scoped notification
-- stream; this separate table is the hospital-only audit trail.

alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_suspended_reason_length_check'
  ) then
    alter table public.profiles
      add constraint profiles_suspended_reason_length_check
      check (suspended_reason is null or char_length(suspended_reason) <= 500);
  end if;
end
$$;

create or replace function public.lifeline_is_current_user_suspended()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.suspended_at is not null
  )
$$;

revoke all on function public.lifeline_is_current_user_suspended() from PUBLIC, anon;
grant execute on function public.lifeline_is_current_user_suspended() to authenticated;

create or replace function public.lifeline_require_active_request_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and auth.role() <> 'service_role'
     and public.lifeline_current_role() in ('patient', 'donor')
     and public.lifeline_is_current_user_suspended() then
    raise exception 'This account is suspended. Contact the hospital for assistance.';
  end if;
  return new;
end
$$;

drop trigger if exists requests_require_active_account on public.requests;
create trigger requests_require_active_account
  before insert or update on public.requests
  for each row execute function public.lifeline_require_active_request_account();
revoke all on function public.lifeline_require_active_request_account()
  from PUBLIC, anon, authenticated;

create or replace function public.lifeline_suspend_connected_account(
  p_profile_id uuid,
  p_reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role text;
  suspended_on timestamptz;
  hospital_id uuid;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'hospital' then
    raise exception 'Only a hospital can suspend an account connected to its requests.';
  end if;
  if p_profile_id is null or p_profile_id = auth.uid()
     or p_reason is null or char_length(trim(p_reason)) < 3
     or char_length(p_reason) > 500 then
    raise exception 'Enter a short suspension reason (3 to 500 characters).';
  end if;

  hospital_id := public.lifeline_current_hospital_id();
  select p.role into target_role
  from public.profiles p where p.id = p_profile_id for update;
  if target_role is null or target_role not in ('patient', 'donor') then
    raise exception 'Only a patient or donor account can be suspended.';
  end if;
  if target_role = 'patient' and not exists (
    select 1 from public.requests r
    where r.patient_id = p_profile_id and r.hospital_id = hospital_id
  ) then
    raise exception 'This patient is not connected to your hospital.';
  end if;
  if target_role = 'donor' and not exists (
    select 1 from public.donor_appointments a
    where a.donor_id = p_profile_id and a.hospital_id = hospital_id
  ) then
    raise exception 'This donor is not connected to your hospital.';
  end if;

  update public.profiles
  set suspended_at = coalesce(suspended_at, now()),
      suspended_reason = trim(p_reason)
  where id = p_profile_id
  returning suspended_at into suspended_on;
  return suspended_on;
end
$$;

revoke all on function public.lifeline_suspend_connected_account(uuid, text)
  from PUBLIC, anon;
grant execute on function public.lifeline_suspend_connected_account(uuid, text)
  to authenticated;

-- This trigger provides an additional guard if an authenticated client reaches
-- a message insert without using the app's normal composer.
create or replace function public.lifeline_guard_chat_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if auth.uid() is null or new.sender_id <> auth.uid() then
    raise exception 'Messages must be sent by the signed-in account.';
  end if;
  if public.lifeline_is_current_user_suspended() then
    raise exception 'This account is suspended and cannot send messages.';
  end if;
  return new;
end
$$;

drop trigger if exists chat_messages_guard_sender on public.chat_messages;
create trigger chat_messages_guard_sender
  before insert on public.chat_messages
  for each row execute function public.lifeline_guard_chat_message_sender();
revoke all on function public.lifeline_guard_chat_message_sender()
  from PUBLIC, anon, authenticated;

create or replace function public.lifeline_guard_appointment_donor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' and exists (
    select 1 from public.profiles p
    where p.id = new.donor_id and p.suspended_at is not null
  ) then
    raise exception 'This account is suspended and cannot volunteer.';
  end if;
  return new;
end
$$;

drop trigger if exists donor_appointments_guard_suspended_donor on public.donor_appointments;
create trigger donor_appointments_guard_suspended_donor
  before insert on public.donor_appointments
  for each row execute function public.lifeline_guard_appointment_donor();
revoke all on function public.lifeline_guard_appointment_donor()
  from PUBLIC, anon, authenticated;

create or replace function public.lifeline_rate_limit_chat_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if auth.uid() is null or new.sender_id <> auth.uid() then
    raise exception 'Messages must be sent by the signed-in account.';
  end if;

  -- Serialize sends by sender across different conversations.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists (
    select 1 from public.chat_messages m
    where m.sender_id = auth.uid()
      and m.created_at > clock_timestamp() - interval '1 second'
  ) then
    raise exception 'Please wait a moment before sending another message.';
  end if;
  new.created_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists chat_messages_rate_limit on public.chat_messages;
create trigger chat_messages_rate_limit
  before insert on public.chat_messages
  for each row execute function public.lifeline_rate_limit_chat_messages();
revoke all on function public.lifeline_rate_limit_chat_messages()
  from PUBLIC, anon, authenticated;

-- Tighten thread access without changing the permitted patient/hospital and
-- donor/hospital conversation types or the existing notification system.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_threads'::regclass
      and conname = 'chat_threads_phase4_allowed_type_check'
  ) then
    alter table public.chat_threads
      add constraint chat_threads_phase4_allowed_type_check
      check (thread_type in ('patient_hospital', 'donor_hospital'));
  end if;
end
$$;
revoke insert, update, delete on public.chat_threads from PUBLIC, anon, authenticated;

create or replace function public.lifeline_can_access_chat_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.lifeline_is_current_user_suspended()
    and exists (
      select 1 from public.chat_threads t
      where t.id = p_thread_id
        and (
          (t.thread_type = 'patient_hospital'
            and t.participant_id = auth.uid()
            and public.lifeline_current_role() = 'patient'
            and exists (
              select 1 from public.requests r
              where r.id = t.request_id and r.patient_id = auth.uid()
            ))
          or (t.thread_type = 'donor_hospital'
            and t.participant_id = auth.uid()
            and public.lifeline_current_role() = 'donor'
            and exists (
              select 1 from public.donor_appointments a
              where a.request_id = t.request_id
                and a.donor_id = auth.uid()
                and a.hospital_id = t.hospital_id
                and a.status in ('scheduled', 'donated', 'deferred', 'no_show')
            ))
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'hospital'
              and p.hospital_id = t.hospital_id
          )
        )
    )
$$;

revoke all on function public.lifeline_can_access_chat_thread(uuid) from PUBLIC, anon;
grant execute on function public.lifeline_can_access_chat_thread(uuid) to authenticated;

create or replace function public.lifeline_guard_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.requests%rowtype;
begin
  select * into request_row from public.requests where id = new.request_id;
  if request_row.id is null or new.hospital_id is distinct from request_row.hospital_id then
    raise exception 'A conversation must belong to the request hospital.';
  end if;
  if new.thread_type = 'patient_hospital' then
    if new.participant_id is distinct from request_row.patient_id then
      raise exception 'Patient conversations must be linked to the request patient.';
    end if;
  elsif new.thread_type = 'donor_hospital' then
    if not exists (
      select 1 from public.donor_appointments a
      where a.request_id = new.request_id
        and a.hospital_id = new.hospital_id
        and a.donor_id = new.participant_id
        and a.status in ('scheduled', 'donated', 'deferred', 'no_show')
    ) then
      raise exception 'Donor conversations require a hospital appointment.';
    end if;
  else
    raise exception 'Only patient/hospital and donor/hospital conversations are allowed.';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = new.participant_id and p.suspended_at is not null
  ) then
    raise exception 'A suspended account cannot create a conversation.';
  end if;
  return new;
end
$$;

drop trigger if exists chat_threads_guard on public.chat_threads;
create trigger chat_threads_guard
  before insert on public.chat_threads
  for each row execute function public.lifeline_guard_chat_thread();
revoke all on function public.lifeline_guard_chat_thread()
  from PUBLIC, anon, authenticated;

create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  thread_id uuid references public.chat_threads(id) on delete set null,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reporter_role text not null check (reporter_role in ('patient', 'donor', 'hospital')),
  reason text not null check (
    reason in ('payment_requested_offered', 'suspicious_request', 'harassment', 'other')
  ),
  details text check (details is null or char_length(details) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists abuse_reports_hospital_created_idx
  on public.abuse_reports(hospital_id, created_at desc);
alter table public.abuse_reports enable row level security;
revoke all on public.abuse_reports from PUBLIC, anon, authenticated;
grant select (id, request_id, hospital_id, thread_id, reporter_role, reason, details, created_at)
  on public.abuse_reports to authenticated;
grant all on public.abuse_reports to service_role;

drop policy if exists abuse_reports_read_hospital on public.abuse_reports;
create policy abuse_reports_read_hospital on public.abuse_reports
  for select to authenticated
  using (
    public.lifeline_current_role() = 'hospital'
    and hospital_id = public.lifeline_current_hospital_id()
  );

create or replace function public.lifeline_submit_abuse_report(
  p_request_id uuid,
  p_reason text,
  p_details text default null,
  p_thread_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.requests%rowtype;
  reporter_role text;
  report_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before sending a report.';
  end if;
  if p_reason is null
     or p_reason not in ('payment_requested_offered', 'suspicious_request', 'harassment', 'other')
     or char_length(coalesce(p_details, '')) > 1000 then
    raise exception 'Choose a report reason and keep details to 1000 characters or fewer.';
  end if;
  select * into request_row from public.requests where id = p_request_id;
  if request_row.id is null then
    raise exception 'This request is not available for reporting.';
  end if;
  reporter_role := public.lifeline_current_role();
  if reporter_role = 'patient' and request_row.patient_id = auth.uid() then
    null;
  elsif reporter_role = 'donor' and (
    exists (
      select 1 from public.donor_appointments a
      where a.request_id = request_row.id and a.donor_id = auth.uid()
    )
    or (
      request_row.status = 'pending'
      and request_row.blood_type::text = public.lifeline_current_blood_type()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.donor_status = 'active'
      )
    )
  ) then
    null;
  elsif reporter_role = 'hospital'
    and request_row.hospital_id = public.lifeline_current_hospital_id() then
    null;
  else
    raise exception 'This request is not available for reporting by your account.';
  end if;
  if p_thread_id is not null and not exists (
    select 1 from public.chat_threads t
    where t.id = p_thread_id and t.request_id = p_request_id
      and public.lifeline_can_access_chat_thread(t.id)
  ) then
    raise exception 'This conversation is not available for reporting.';
  end if;

  insert into public.abuse_reports
    (request_id, hospital_id, thread_id, reporter_id, reporter_role, reason, details)
  values
    (request_row.id, request_row.hospital_id, p_thread_id, auth.uid(),
     reporter_role, p_reason, nullif(trim(p_details), ''))
  returning id into report_id;
  return report_id;
end
$$;

revoke all on function public.lifeline_submit_abuse_report(uuid, text, text, uuid)
  from PUBLIC, anon;
grant execute on function public.lifeline_submit_abuse_report(uuid, text, text, uuid)
  to authenticated;

create table if not exists public.request_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists request_audit_events_hospital_created_idx
  on public.request_audit_events(hospital_id, created_at desc);
alter table public.request_audit_events enable row level security;
revoke all on public.request_audit_events from PUBLIC, anon, authenticated;
grant select on public.request_audit_events to authenticated;
grant all on public.request_audit_events to service_role;

drop policy if exists request_audit_events_read_hospital on public.request_audit_events;
create policy request_audit_events_read_hospital on public.request_audit_events
  for select to authenticated
  using (
    public.lifeline_current_role() = 'hospital'
    and hospital_id = public.lifeline_current_hospital_id()
  );

create or replace function public.lifeline_audit_request_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.request_audit_events
      (request_id, hospital_id, actor_id, event, from_status, to_status, note)
    values
      (new.id, new.hospital_id, auth.uid(), 'request.created',
       null, new.status::text, nullif(trim(new.hospital_note), ''));
  elsif new.status is distinct from old.status then
    insert into public.request_audit_events
      (request_id, hospital_id, actor_id, event, from_status, to_status, note)
    values
      (new.id, new.hospital_id, auth.uid(), 'request.status_changed',
       old.status::text, new.status::text, nullif(trim(new.hospital_note), ''));
  end if;
  return new;
end
$$;

drop trigger if exists requests_audit_status on public.requests;
create trigger requests_audit_status
  after insert or update of status on public.requests
  for each row execute function public.lifeline_audit_request_status();
revoke all on function public.lifeline_audit_request_status()
  from PUBLIC, anon, authenticated;

create or replace function public.lifeline_audit_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.request_audit_events
    (request_id, hospital_id, actor_id, event, from_status, to_status, note)
  values
    (new.request_id, new.hospital_id, auth.uid(),
     case when tg_op = 'INSERT' then 'appointment.scheduled' else 'appointment.status_changed' end,
     case when tg_op = 'INSERT' then null else old.status end,
     new.status,
     nullif(trim(coalesce(new.hospital_note, new.donor_cancel_reason)), ''));
  return new;
end
$$;

drop trigger if exists donor_appointments_audit on public.donor_appointments;
create trigger donor_appointments_audit
  after insert or update of status, hospital_note, donor_cancel_reason
  on public.donor_appointments
  for each row execute function public.lifeline_audit_appointment_change();
revoke all on function public.lifeline_audit_appointment_change()
  from PUBLIC, anon, authenticated;

-- Catalog assertions prove the sensitive tables and protected columns are
-- configured as intended; account-specific RLS checks follow below as manual
-- run-as-role steps because test account UUIDs belong to each deployment.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.abuse_reports'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.request_audit_events'::regclass) then
    raise exception 'Privacy check failed: reports and audit events must have RLS enabled.';
  end if;
  if has_table_privilege('authenticated', 'public.abuse_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.abuse_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.abuse_reports', 'DELETE')
     or has_table_privilege('authenticated', 'public.request_audit_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.request_audit_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.request_audit_events', 'DELETE') then
    raise exception 'Privilege check failed: reports and audit events must use guarded writes.';
  end if;
  if has_column_privilege('authenticated', 'public.abuse_reports', 'reporter_id', 'SELECT') then
    raise exception 'Privacy check failed: hospital report readers must not see reporter identity.';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'suspended_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'suspended_reason', 'UPDATE') then
    raise exception 'Privilege check failed: users cannot edit their own suspension state.';
  end if;
  if has_table_privilege('authenticated', 'public.chat_threads', 'INSERT') then
    raise exception 'Privacy check failed: clients must not create chat threads directly.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.chat_messages'::regclass
      and tgname = 'chat_messages_rate_limit' and not tgisinternal
  ) then
    raise exception 'Abuse prevention check failed: database chat throttle is missing.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.requests'::regclass
      and tgname = 'requests_require_active_account' and not tgisinternal
  ) then
    raise exception 'Abuse prevention check failed: request suspension guard is missing.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.donor_appointments'::regclass
      and tgname = 'donor_appointments_guard_suspended_donor' and not tgisinternal
  ) then
    raise exception 'Abuse prevention check failed: appointment suspension guard is missing.';
  end if;
end
$$;

-- Account-specific SQL negative checks (substitute UUIDs for your own test
-- users and execute each block as the indicated authenticated account):
-- 1. As a suspended patient, INSERT a request or call lifeline_suspend_connected_account;
--    request creation must fail and only a hospital may invoke suspension.
-- 2. As a suspended donor, call lifeline_book_donor_appointment or INSERT a chat message;
--    both must fail. Existing chat reads must return no rows.
-- 3. As a non-involved hospital, SELECT abuse_reports and request_audit_events;
--    rows for another hospital must not be visible. As the related hospital, they are visible.
-- 4. As a donor, select patient_requests (must return no patient request rows) and
--    profiles for a patient (must return no profile rows); repeat as a patient for donor data.
-- 5. As patient or donor, INSERT a chat_threads row of either thread_type directly;
--    permission must be denied. A direct patient-to-donor thread type must also fail
--    the chat_threads constraint/guard even if attempted by a privileged test session.
-- 6. As the related patient/donor, call lifeline_submit_abuse_report with each
--    allowed reason; direct INSERT into abuse_reports must be denied. Unrelated
--    users must be denied by the RPC.
-- 7. Send two chat_messages from the same user less than one second apart, including
--    from different threads; the second insert must be rejected by the database.
