-- Remove public marketplace access to request and profile identities.
-- Role-specific views below deliberately expose only the data each role needs.

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'requests'
      and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on public.requests', policy_row.policyname);
  end loop;
end $$;

alter table public.requests enable row level security;
create policy requests_read_patient on public.requests
  for select to authenticated
  using (patient_id = auth.uid() and public.lifeline_current_role() = 'patient');
create policy requests_read_hospital on public.requests
  for select to authenticated
  using (hospital_id = public.lifeline_current_hospital_id()
         and public.lifeline_current_role() = 'hospital');

-- Authenticated clients can read only non-identifying request columns. Donors
-- have no base-table SELECT policy; they use donor_calls instead.
revoke all on public.requests from PUBLIC, anon, authenticated;
revoke all (patient_id, donor_id, patient_lat, patient_lng, donor_lat, donor_lng,
            declined_by)
  on table public.requests from PUBLIC, anon, authenticated;
grant select (id, blood_type, units, urgency, status, created_at, hospital_id,
              hospital_note, hospital_decision_at)
  on public.requests to authenticated;
grant insert (patient_id, blood_type, units, urgency, status, hospital_id)
  on public.requests to authenticated;
grant update (blood_type, units, urgency, status, hospital_id, hospital_note,
              hospital_decision_at)
  on public.requests to authenticated;
grant all on public.requests to service_role;

-- Replace profile policies with owner-only access and updates.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', policy_row.policyname);
  end loop;
end $$;

alter table public.profiles enable row level security;
revoke all on public.profiles from PUBLIC, anon, authenticated;
revoke update (id, role, hospital_id) on public.profiles from PUBLIC, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, address, blood_type, donor_status)
  on public.profiles to authenticated;
create policy profiles_read_self on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Retire the legacy donor-count view if this project has it. The replacement
-- aggregate is available only through hospital_volunteer_registry.
do $$
begin
  if to_regclass('public.blood_availability') is not null then
    execute 'revoke all on public.blood_availability from PUBLIC, anon, authenticated';
  end if;
end $$;

-- Do not stream raw requests rows: realtime payloads include columns even
-- when the subscriber's column grants do not. Stream recipient-scoped events.
create table if not exists public.request_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  request_id uuid not null references public.requests(id) on delete cascade,
  status text not null,
  blood_type text not null,
  units integer not null,
  urgency text not null,
  hospital_id uuid,
  hospital_note text,
  created_at timestamptz not null default now()
);
create index if not exists request_events_recipient_created_idx
  on public.request_events(recipient_id, created_at desc);
alter table public.request_events enable row level security;
drop policy if exists request_events_read_self on public.request_events;
create policy request_events_read_self on public.request_events
  for select to authenticated using (recipient_id = auth.uid());
revoke all on public.request_events from PUBLIC, anon, authenticated;
grant select on public.request_events to authenticated;
grant all on public.request_events to service_role;

create or replace function public.lifeline_emit_request_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hospital_profile record;
  volunteer_profile record;
  event_name text;
begin
  if new.status = 'pending_hospital' then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      for hospital_profile in
        select p.id from public.profiles p
        where p.role = 'hospital' and p.hospital_id = new.hospital_id
      loop
        insert into public.request_events
          (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
        values (hospital_profile.id, 'hospital_incoming', new.id, new.status,
                new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
      end loop;
    end if;
    return new;
  end if;

  if tg_op <> 'UPDATE' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'pending' and old.status = 'pending_hospital' then
    event_name := 'patient_approved';
    insert into public.request_events
      (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
    values (new.patient_id, event_name, new.id, new.status,
            new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    for volunteer_profile in
      select p.id from public.profiles p
      where p.role = 'donor' and p.donor_status = 'active'
        and p.blood_type::text = new.blood_type::text
    loop
      insert into public.request_events
        (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
      values (volunteer_profile.id, 'donor_call', new.id, new.status,
              new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    end loop;
  elsif new.status = 'hospital_declined' then
    insert into public.request_events
      (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id, hospital_note)
    values (new.patient_id, 'patient_declined', new.id, new.status,
            new.blood_type::text, new.units, new.urgency::text, new.hospital_id, new.hospital_note);
  elsif new.status = 'accepted' then
    insert into public.request_events
      (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
    values (new.patient_id, 'patient_volunteer', new.id, new.status,
            new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    for hospital_profile in
      select p.id from public.profiles p
      where p.role = 'hospital' and p.hospital_id = new.hospital_id
    loop
      insert into public.request_events
        (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
      values (hospital_profile.id, 'hospital_volunteer', new.id, new.status,
              new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    end loop;
  elsif new.status = 'pending' and old.status = 'accepted' then
    insert into public.request_events
      (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
    values (new.patient_id, 'patient_volunteer_withdrawn', new.id, new.status,
            new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    for hospital_profile in
      select p.id from public.profiles p
      where p.role = 'hospital' and p.hospital_id = new.hospital_id
    loop
      insert into public.request_events
        (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
      values (hospital_profile.id, 'hospital_volunteer_withdrawn', new.id, new.status,
              new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    end loop;
    for volunteer_profile in
      select p.id from public.profiles p
      where p.role = 'donor' and p.donor_status = 'active'
        and p.blood_type::text = new.blood_type::text
    loop
      insert into public.request_events
        (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
      values (volunteer_profile.id, 'donor_call', new.id, new.status,
              new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
    end loop;
  elsif new.status in ('cancelled', 'completed') then
    insert into public.request_events
      (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
    values (new.patient_id, 'patient_progress', new.id, new.status,
            new.blood_type::text, new.units, new.urgency::text, new.hospital_id);
  end if;

  return new;
end $$;

drop trigger if exists requests_emit_privacy_safe_events on public.requests;
create trigger requests_emit_privacy_safe_events
  after insert or update of status on public.requests
  for each row execute function public.lifeline_emit_request_events();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'requests'
    ) then
      alter publication supabase_realtime drop table public.requests;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'request_events'
    ) then
      alter publication supabase_realtime add table public.request_events;
    end if;
  end if;
end $$;

create or replace view public.patient_requests
  with (security_barrier = true)
as
select r.id, r.blood_type, r.units, r.urgency, r.status, r.created_at,
       r.hospital_id, h.name as hospital_name, h.address as hospital_address,
       r.hospital_note, r.hospital_decision_at,
       case when r.donor_id is null then 0 else 1 end as volunteer_count
from public.requests r
join public.hospitals h on h.id = r.hospital_id
where r.patient_id = auth.uid()
  and public.lifeline_current_role() = 'patient';

create or replace view public.hospital_requests
  with (security_barrier = true)
as
select r.id, r.patient_id, r.blood_type, r.units, r.urgency, r.status,
       r.created_at, r.hospital_id, r.hospital_note, r.hospital_decision_at,
       jsonb_build_object(
         'id', p.id,
         'full_name', p.full_name,
         'phone', p.phone,
         'blood_type', p.blood_type
       ) as patient
from public.requests r
join public.profiles p on p.id = r.patient_id
where r.hospital_id = public.lifeline_current_hospital_id()
  and public.lifeline_current_role() = 'hospital';

create or replace view public.donor_calls
  with (security_barrier = true)
as
select r.id, r.blood_type, r.units, r.urgency, r.status, r.created_at,
       r.hospital_id, h.name as hospital_name, h.address as hospital_address
from public.requests r
join public.hospitals h on h.id = r.hospital_id
join public.profiles volunteer
  on volunteer.id = auth.uid()
 and volunteer.role = 'donor'
 and volunteer.blood_type::text = r.blood_type::text
where public.lifeline_current_role() = 'donor'
  and (
    (r.status = 'pending' and r.donor_id is null
      and volunteer.donor_status = 'active')
    or (r.status in ('accepted', 'completed') and r.donor_id = auth.uid())
  );

create or replace view public.hospital_volunteer_registry
  with (security_barrier = true)
as
select p.blood_type, count(*)::integer as volunteer_count
from public.profiles p
where p.role = 'donor'
  and p.donor_status = 'active'
  and p.blood_type is not null
  and public.lifeline_current_role() = 'hospital'
group by p.blood_type;

revoke all on public.patient_requests, public.hospital_requests,
  public.donor_calls, public.hospital_volunteer_registry from PUBLIC, anon, authenticated;
grant select on public.patient_requests, public.hospital_requests,
  public.donor_calls, public.hospital_volunteer_registry to authenticated;

create or replace function public.lifeline_volunteer_for_call(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'donor' then
    raise exception 'Only donors can volunteer for a call';
  end if;

  update public.requests r
     set donor_id = auth.uid(), status = 'accepted'
   where r.id = p_request_id
     and r.status = 'pending'
     and r.donor_id is null
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid()
         and p.role = 'donor'
         and p.donor_status = 'active'
         and p.blood_type::text = r.blood_type::text
     );

  get diagnostics affected = row_count;
  return affected = 1;
end $$;

create or replace function public.lifeline_withdraw_from_call(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'donor' then
    raise exception 'Only donors can withdraw from a call';
  end if;

  update public.requests
     set donor_id = null, status = 'pending'
   where id = p_request_id
     and donor_id = auth.uid()
     and status = 'accepted';

  get diagnostics affected = row_count;
  return affected = 1;
end $$;

revoke all on function public.lifeline_volunteer_for_call(uuid) from public, anon;
revoke all on function public.lifeline_withdraw_from_call(uuid) from public, anon;
grant execute on function public.lifeline_volunteer_for_call(uuid) to authenticated;
grant execute on function public.lifeline_withdraw_from_call(uuid) to authenticated;

-- Existing chat policies looked up donor_id on requests. A participant's
-- immutable, database-created thread is sufficient authorization and avoids
-- restoring donor access to the request table.
create or replace function public.lifeline_can_access_chat_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.chat_threads t
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
            select 1 from public.requests r
            where r.id = t.request_id and r.donor_id = auth.uid()
              and r.status in ('accepted', 'completed')
          ))
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'hospital'
            and p.hospital_id = t.hospital_id
        )
      )
  )
$$;
revoke all on function public.lifeline_can_access_chat_thread(uuid) from public, anon;
grant execute on function public.lifeline_can_access_chat_thread(uuid) to authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename in ('chat_threads', 'chat_messages')
  loop
    execute format('drop policy %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end $$;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_threads_read_participants on public.chat_threads
  for select to authenticated using (public.lifeline_can_access_chat_thread(id));

create policy chat_messages_read_participants on public.chat_messages
  for select to authenticated using (public.lifeline_can_access_chat_thread(thread_id));

create policy chat_messages_insert_participants on public.chat_messages
  for insert to authenticated
  with check (sender_id = auth.uid()
              and public.lifeline_can_access_chat_thread(thread_id));

create policy chat_messages_mark_received_read on public.chat_messages
  for update to authenticated
  using (sender_id <> auth.uid()
         and public.lifeline_can_access_chat_thread(thread_id))
  with check (sender_id <> auth.uid() and read_at is not null
              and public.lifeline_can_access_chat_thread(thread_id));

revoke all on public.chat_threads, public.chat_messages from PUBLIC, anon, authenticated;
grant select on public.chat_threads to authenticated;
grant select, insert on public.chat_messages to authenticated;
grant update (read_at) on public.chat_messages to authenticated;
grant all on public.chat_threads, public.chat_messages to service_role;

create or replace function public.lifeline_guard_chat_message_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at')
    or old.read_at is not null or new.read_at is null then
    raise exception 'Recipients may only mark unread messages as read';
  end if;
  if not public.lifeline_can_access_chat_thread(old.thread_id) then
    raise exception 'You are not a recipient of this message';
  end if;
  return new;
end $$;

-- Static privilege/schema assertions: these fail the migration if protected
-- identity columns become selectable or appear in donor-facing views.
do $$
begin
  if has_column_privilege('authenticated', 'public.requests', 'patient_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'donor_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'patient_lat', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'patient_lng', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'donor_lat', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'donor_lng', 'SELECT') then
    raise exception 'Privacy check failed: an identity or location column is selectable';
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'hospital_id', 'UPDATE') then
    raise exception 'Privacy check failed: profile role or hospital assignment is client-updatable';
  end if;

  if to_regclass('public.blood_availability') is not null
     and has_table_privilege('authenticated', 'public.blood_availability', 'SELECT') then
    raise exception 'Privacy check failed: legacy donor counts remain directly readable';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'donor_calls'
      and column_name in ('patient_id', 'patient_name', 'patient_phone',
                          'patient_address', 'patient_lat', 'patient_lng', 'patient',
                          'donor_id', 'donor_name', 'donor_phone', 'donor',
                          'phone', 'address', 'lat', 'lng')
  ) then
    raise exception 'Privacy check failed: donor_calls exposes identifying data';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_requests'
      and column_name in ('donor_id', 'donor_name', 'donor_phone',
                          'donor_address', 'donor_lat', 'donor_lng')
  ) then
    raise exception 'Privacy check failed: patient_requests exposes volunteer identity';
  end if;

  if has_column_privilege('authenticated', 'public.chat_threads', 'participant_id', 'SELECT') is false then
    raise exception 'Privacy check failed: chat participants must retain thread access';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'requests'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
      and qual ilike '%donor%'
  ) then
    raise exception 'Privacy check failed: a donor request-table SELECT policy remains';
  end if;
end $$;

-- Runtime negative checks (run separately in the SQL editor with real user UUIDs):
-- Replace the UUID placeholder, run the block, then repeat for the other role.
--
-- Donor test: patient identity reads must be denied/empty.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claim.sub', '<DONOR_UUID>', true);
-- do $test$
-- declare denied boolean := false;
-- begin
--   begin
--     execute 'select patient_id from public.requests limit 1';
--   exception when insufficient_privilege then denied := true;
--   end;
--   if not denied then raise exception 'Donor could select requests.patient_id'; end if;
--   if exists (select 1 from public.profiles where role = 'patient') then
--     raise exception 'Donor could read a patient profile';
--   end if;
--   if exists (select 1 from public.patient_requests) then
--     raise exception 'Donor could read the patient request view';
--   end if;
-- end
-- $test$;
-- rollback;
--
-- Patient test: donor identity reads must be denied/empty.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claim.sub', '<PATIENT_UUID>', true);
-- do $test$
-- declare denied boolean := false;
-- begin
--   begin
--     execute 'select donor_id from public.requests limit 1';
--   exception when insufficient_privilege then denied := true;
--   end;
--   if not denied then raise exception 'Patient could select requests.donor_id'; end if;
--   if exists (select 1 from public.profiles where role = 'donor') then
--     raise exception 'Patient could read a donor profile';
--   end if;
-- end
-- $test$;
-- rollback;
--
-- Donor view shape negative case: `select patient_id from public.donor_calls`
-- must fail with undefined_column; `select * from public.donor_calls` is safe.
