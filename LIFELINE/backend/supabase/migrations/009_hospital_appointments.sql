-- Hospital-managed appointment windows and race-safe volunteer scheduling.

drop policy if exists hospitals_read_approved on public.hospitals;
create policy hospitals_read_approved on public.hospitals
  for select to anon, authenticated
  using (is_approved and is_active);

alter table public.profiles
  add column if not exists donation_count integer not null default 0;

alter table public.requests
  add column if not exists units_confirmed integer not null default 0,
  add column if not exists hospital_response_timed_out boolean not null default false,
  add column if not exists open_status_at timestamptz;

update public.requests
set open_status_at = created_at
where open_status_at is null;

alter table public.requests
  alter column open_status_at set default now(),
  alter column open_status_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.requests'::regclass
      and conname = 'requests_units_confirmed_check'
  ) then
    alter table public.requests
      add constraint requests_units_confirmed_check
      check (units_confirmed >= 0 and units_confirmed <= units);
  end if;
end
$$;

create table if not exists public.donor_call_windows (
  request_id uuid primary key references public.requests(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  window_start timestamptz not null,
  window_end timestamptz not null,
  slot_minutes integer not null default 30
    check (slot_minutes in (30, 60)),
  updated_at timestamptz not null default now(),
  check (window_end > window_start)
);

create table if not exists public.donor_appointments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  donor_id uuid not null references public.profiles(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  slot_start timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'donated', 'deferred', 'no_show', 'cancelled')),
  hospital_note text check (hospital_note is null or char_length(hospital_note) <= 500),
  donor_cancel_reason text check (donor_cancel_reason is null or char_length(donor_cancel_reason) <= 300),
  created_at timestamptz not null default now()
);

create unique index if not exists donor_appointments_one_active_per_donor_request_idx
  on public.donor_appointments(request_id, donor_id)
  where status = 'scheduled';
create index if not exists donor_appointments_hospital_slot_idx
  on public.donor_appointments(hospital_id, slot_start)
  where status = 'scheduled';
create index if not exists donor_appointments_request_status_idx
  on public.donor_appointments(request_id, status);

alter table public.donor_call_windows enable row level security;
alter table public.donor_appointments enable row level security;
revoke all on public.donor_call_windows, public.donor_appointments
  from PUBLIC, anon, authenticated;
grant select on public.donor_call_windows, public.donor_appointments to authenticated;
grant all on public.donor_call_windows, public.donor_appointments to service_role;

create or replace function public.lifeline_can_view_donor_call(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.lifeline_current_role() = 'donor'
    and exists (
      select 1
      from public.requests r
      join public.profiles donor on donor.id = auth.uid()
      where r.id = p_request_id
        and r.status = 'pending'
        and r.blood_type::text = donor.blood_type::text
        and donor.donor_status = 'active'
        and (
          r.units_confirmed
          + (select count(*) from public.donor_appointments a
             where a.request_id = r.id and a.status = 'scheduled')
        ) < r.units
    )
$$;

revoke all on function public.lifeline_can_view_donor_call(uuid) from PUBLIC, anon;
grant execute on function public.lifeline_can_view_donor_call(uuid) to authenticated;

drop policy if exists donor_call_windows_read_participants on public.donor_call_windows;
create policy donor_call_windows_read_participants on public.donor_call_windows
  for select to authenticated
  using (
    (public.lifeline_current_role() = 'hospital'
      and hospital_id = public.lifeline_current_hospital_id())
    or public.lifeline_can_view_donor_call(request_id)
  );

drop policy if exists donor_appointments_read_participants on public.donor_appointments;
create policy donor_appointments_read_participants on public.donor_appointments
  for select to authenticated
  using (
    (public.lifeline_current_role() = 'donor' and donor_id = auth.uid())
    or (public.lifeline_current_role() = 'hospital'
        and hospital_id = public.lifeline_current_hospital_id())
  );

create or replace function public.lifeline_can_read_donor_precheck(
  p_request_id uuid,
  p_hospital_id uuid,
  p_donor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.lifeline_current_role() = 'hospital'
    and public.lifeline_current_hospital_id() = p_hospital_id
    and exists (
      select 1 from public.donor_appointments a
      where a.request_id = p_request_id
        and a.hospital_id = p_hospital_id
        and a.donor_id = p_donor_id
        and a.status in ('scheduled', 'donated', 'deferred', 'no_show')
    )
$$;

revoke all on function public.lifeline_can_read_donor_precheck(uuid, uuid, uuid)
  from PUBLIC, anon;
grant execute on function public.lifeline_can_read_donor_precheck(uuid, uuid, uuid)
  to authenticated;

-- Retire the legacy one-donor response path; volunteering now requires a
-- capacity-checked appointment booking.
revoke all on function public.lifeline_volunteer_for_call(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.lifeline_withdraw_from_call(uuid)
  from PUBLIC, anon, authenticated;

-- Existing single-donor responses must be resubmitted through slot booking.
-- Suppress legacy request guards/events while normalizing these rows.
alter table public.requests disable trigger USER;
update public.requests
set status = 'pending', donor_id = null
where status = 'accepted' and donor_id is not null;
alter table public.requests enable trigger USER;

create or replace function public.lifeline_set_request_open_status_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.open_status_at := now();
  elsif new.status is distinct from old.status
        and new.status in ('pending_hospital', 'pending') then
    new.open_status_at := now();
  end if;
  return new;
end
$$;

create or replace function public.lifeline_guard_request_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  active_count integer;
begin
  if new.units is distinct from old.units
     or new.blood_type is distinct from old.blood_type then
    select count(*) into active_count
    from public.donor_appointments a
    where a.request_id = old.id and a.status = 'scheduled';
    if new.units < old.units_confirmed + active_count then
      raise exception 'Units cannot be reduced below the number of confirmed and scheduled volunteers.';
    end if;
    if new.blood_type is distinct from old.blood_type and exists (
      select 1 from public.donor_appointments a
      where a.request_id = old.id and a.status in ('scheduled', 'donated')
    ) then
      raise exception 'Blood type cannot be changed after a volunteer appointment is booked.';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists requests_guard_appointment_capacity on public.requests;
create trigger requests_guard_appointment_capacity
  before update of units, blood_type on public.requests
  for each row execute function public.lifeline_guard_request_capacity();

drop trigger if exists requests_set_open_status_at on public.requests;
create trigger requests_set_open_status_at
  before insert or update of status on public.requests
  for each row execute function public.lifeline_set_request_open_status_at();

create or replace function public.lifeline_save_donor_call_window(
  p_request_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_slot_minutes integer
)
returns public.donor_call_windows
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  call_row public.requests%rowtype;
  saved_window public.donor_call_windows%rowtype;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'hospital' then
    raise exception 'Only the assigned hospital can set appointment times.';
  end if;
  select * into call_row
  from public.requests
  where id = p_request_id
    and hospital_id = public.lifeline_current_hospital_id()
  for update;
  if call_row.id is null or call_row.status <> 'pending' then
    raise exception 'Only an open hospital call can have appointment times.';
  end if;
  if p_window_start is null or p_window_end is null
     or p_window_start <= now()
     or p_window_end <= p_window_start
     or p_window_end > now() + interval '14 days'
     or p_slot_minutes is null
     or p_slot_minutes not in (30, 60)
     or p_window_end - p_window_start < make_interval(mins => p_slot_minutes) then
    raise exception 'Choose a future time window within 14 days and a 30- or 60-minute slot length.';
  end if;
  if exists (
    select 1 from public.donor_appointments a
    where a.request_id = p_request_id and a.status = 'scheduled'
      and (
        a.slot_start < p_window_start
        or a.slot_start + make_interval(mins => p_slot_minutes) > p_window_end
        or mod(extract(epoch from (a.slot_start - p_window_start))::bigint,
               p_slot_minutes * 60) <> 0
      )
  ) then
    raise exception 'The updated window must keep all already-booked appointment times.';
  end if;

  insert into public.donor_call_windows
    (request_id, hospital_id, window_start, window_end, slot_minutes, updated_at)
  values
    (p_request_id, call_row.hospital_id, p_window_start, p_window_end, p_slot_minutes, now())
  on conflict (request_id) do update set
    hospital_id = excluded.hospital_id,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    slot_minutes = excluded.slot_minutes,
    updated_at = now()
  returning * into saved_window;
  return saved_window;
end
$$;

revoke all on function public.lifeline_save_donor_call_window(uuid, timestamptz, timestamptz, integer)
  from PUBLIC, anon;
grant execute on function public.lifeline_save_donor_call_window(uuid, timestamptz, timestamptz, integer)
  to authenticated;

create or replace function public.lifeline_create_appointment_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.chat_threads (request_id, hospital_id, thread_type, participant_id)
  values (new.request_id, new.hospital_id, 'donor_hospital', new.donor_id)
  on conflict (request_id, thread_type, participant_id) do nothing;
  return new;
end
$$;

drop trigger if exists donor_appointments_create_chat_thread on public.donor_appointments;
create trigger donor_appointments_create_chat_thread
  after insert on public.donor_appointments
  for each row execute function public.lifeline_create_appointment_chat_thread();
revoke all on function public.lifeline_create_appointment_chat_thread()
  from PUBLIC, anon, authenticated;

create or replace function public.lifeline_move_patient_thread_with_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.hospital_id is distinct from old.hospital_id and new.hospital_id is not null then
    update public.chat_threads
    set hospital_id = new.hospital_id
    where request_id = new.id and thread_type = 'patient_hospital'
      and participant_id = new.patient_id;
  end if;
  return new;
end
$$;

drop trigger if exists requests_move_patient_thread on public.requests;
create trigger requests_move_patient_thread
  after update of hospital_id on public.requests
  for each row execute function public.lifeline_move_patient_thread_with_request();
revoke all on function public.lifeline_move_patient_thread_with_request()
  from PUBLIC, anon, authenticated;

create or replace function public.lifeline_book_donor_appointment(
  p_request_id uuid,
  p_slot_start timestamptz
)
returns public.donor_appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  donor public.profiles%rowtype;
  call_row public.requests%rowtype;
  call_window public.donor_call_windows%rowtype;
  booked public.donor_appointments%rowtype;
  active_count integer;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'donor' then
    raise exception 'Only donors can book a hospital appointment.';
  end if;
  select * into call_row from public.requests
  where id = p_request_id
  for update;
  if call_row.id is null or call_row.status <> 'pending' then
    raise exception 'This hospital call is no longer open.';
  end if;

  select * into donor from public.profiles
  where id = auth.uid() and role = 'donor';
  if donor.donor_status <> 'active'
     or donor.blood_type::text <> call_row.blood_type::text then
    raise exception 'This hospital call is not available to your account.';
  end if;
  if donor.consent_at is null or donor.consent_version <> '2026-10-v1' then
    raise exception 'Review and accept the donor consent statement before booking.';
  end if;
  if donor.last_donated_at is not null
     and (donor.last_donated_at at time zone 'UTC')::date >
         (now() at time zone 'UTC')::date - 56 then
    raise exception 'You can volunteer again on ' ||
      to_char((donor.last_donated_at at time zone 'UTC')::date + 56, 'FMMonth FMDD, YYYY') || '.';
  end if;
  if not exists (
    select 1 from public.donor_prechecks precheck
    where precheck.request_id = p_request_id
      and precheck.donor_id = auth.uid()
      and precheck.age_18_or_older
      and precheck.weight_50kg_or_more
      and precheck.feeling_well
      and not precheck.recent_illness
      and not precheck.recent_tattoo
      and not precheck.recent_travel
      and not precheck.medication
      and not precheck.recent_donation
  ) then
    raise exception 'Complete a passing pre-check before booking. The hospital makes the final medical decision.';
  end if;

  select * into call_window from public.donor_call_windows
  where request_id = p_request_id and hospital_id = call_row.hospital_id;
  if call_window.request_id is null then
    raise exception 'The hospital has not set appointment times for this call yet.';
  end if;
  if p_slot_start is null or p_slot_start < now()
     or p_slot_start < call_window.window_start
     or p_slot_start + make_interval(mins => call_window.slot_minutes) > call_window.window_end
     or mod(extract(epoch from (p_slot_start - call_window.window_start))::bigint,
            call_window.slot_minutes * 60) <> 0 then
    raise exception 'Choose one of the appointment times provided by the hospital.';
  end if;
  if exists (
    select 1 from public.donor_appointments a
    where a.request_id = p_request_id and a.donor_id = auth.uid()
      and a.status = 'scheduled'
  ) then
    raise exception 'You already have an appointment for this hospital call.';
  end if;
  if exists (
    select 1 from public.donor_appointments a
    where a.request_id = p_request_id and a.donor_id = auth.uid()
      and a.status = 'donated'
  ) then
    raise exception 'Your donation for this hospital call has already been recorded.';
  end if;

  select count(*) into active_count from public.donor_appointments a
  where a.request_id = p_request_id and a.status = 'scheduled';
  if call_row.units_confirmed + active_count >= call_row.units then
    raise exception 'All volunteer appointment places for this call are filled.';
  end if;

  insert into public.donor_appointments
    (request_id, donor_id, hospital_id, slot_start, status)
  values
    (p_request_id, auth.uid(), call_row.hospital_id, p_slot_start, 'scheduled')
  returning * into booked;
  insert into public.request_events
    (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
  values
    (call_row.patient_id, 'patient_volunteer', call_row.id, call_row.status,
     call_row.blood_type::text, call_row.units, call_row.urgency::text, call_row.hospital_id);
  insert into public.request_events
    (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
  select p.id, 'hospital_volunteer', call_row.id, call_row.status,
         call_row.blood_type::text, call_row.units, call_row.urgency::text, call_row.hospital_id
  from public.profiles p
  where p.role = 'hospital' and p.hospital_id = call_row.hospital_id;
  return booked;
end
$$;

revoke all on function public.lifeline_book_donor_appointment(uuid, timestamptz)
  from PUBLIC, anon;
grant execute on function public.lifeline_book_donor_appointment(uuid, timestamptz)
  to authenticated;

create or replace function public.lifeline_cancel_donor_appointment(
  p_appointment_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appointment public.donor_appointments%rowtype;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'donor' then
    raise exception 'Only the volunteer can cancel this appointment.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 2 or char_length(p_reason) > 300 then
    raise exception 'Add a short cancellation reason (up to 300 characters).';
  end if;
  select * into appointment from public.donor_appointments
  where id = p_appointment_id and donor_id = auth.uid()
  for update;
  if appointment.id is null or appointment.status <> 'scheduled' then
    raise exception 'Only a scheduled appointment can be cancelled.';
  end if;
  update public.donor_appointments
  set status = 'cancelled', donor_cancel_reason = trim(p_reason)
  where id = appointment.id;
  insert into public.request_events
    (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
  select r.patient_id, 'patient_progress', r.id, r.status,
         r.blood_type::text, r.units, r.urgency::text, r.hospital_id
  from public.requests r where r.id = appointment.request_id;
  return true;
end
$$;

revoke all on function public.lifeline_cancel_donor_appointment(uuid, text)
  from PUBLIC, anon;
grant execute on function public.lifeline_cancel_donor_appointment(uuid, text)
  to authenticated;

create or replace function public.lifeline_record_appointment_outcome(
  p_appointment_id uuid,
  p_status text,
  p_hospital_note text default null
)
returns public.donor_appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appointment public.donor_appointments%rowtype;
  call_row public.requests%rowtype;
  updated_appointment public.donor_appointments%rowtype;
  confirmed integer;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'hospital' then
    raise exception 'Only the hospital can record an appointment outcome.';
  end if;
  if p_status is null or p_status not in ('donated', 'deferred', 'no_show')
     or char_length(coalesce(p_hospital_note, '')) > 500 then
    raise exception 'Choose Donated, Deferred, or No-show and use a note of 500 characters or fewer.';
  end if;

  select * into appointment from public.donor_appointments
  where id = p_appointment_id
    and hospital_id = public.lifeline_current_hospital_id()
  for update;
  if appointment.id is null or appointment.status <> 'scheduled' then
    raise exception 'This appointment is not scheduled at your hospital.';
  end if;
  select * into call_row from public.requests
  where id = appointment.request_id and hospital_id = appointment.hospital_id
  for update;
  if call_row.id is null or call_row.status <> 'pending' then
    raise exception 'This appointment is not linked to an open call at your hospital.';
  end if;

  update public.donor_appointments
  set status = p_status, hospital_note = nullif(trim(p_hospital_note), '')
  where id = appointment.id
  returning * into updated_appointment;

  if p_status = 'donated' then
    update public.profiles
    set last_donated_at = now(), donation_count = donation_count + 1
    where id = appointment.donor_id and role = 'donor';
    select count(*) into confirmed from public.donor_appointments
    where request_id = call_row.id and status = 'donated';

    perform set_config('request.jwt.claim.role', 'service_role', true);
    update public.requests
    set units_confirmed = confirmed,
        status = case when confirmed >= units then 'completed' else status end
    where id = call_row.id;
    insert into public.request_events
      (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
    values
      (appointment.donor_id, 'donor_thank_you', call_row.id,
       case when confirmed >= call_row.units then 'completed' else call_row.status end,
       call_row.blood_type::text, call_row.units, call_row.urgency::text, call_row.hospital_id);
  end if;
  select * into call_row from public.requests where id = call_row.id;
  insert into public.request_events
    (recipient_id, event_type, request_id, status, blood_type, units, urgency, hospital_id)
  values
    (call_row.patient_id, 'patient_progress', call_row.id, call_row.status,
     call_row.blood_type::text, call_row.units, call_row.urgency::text, call_row.hospital_id);
  return updated_appointment;
end
$$;

revoke all on function public.lifeline_record_appointment_outcome(uuid, text, text)
  from PUBLIC, anon;
grant execute on function public.lifeline_record_appointment_outcome(uuid, text, text)
  to authenticated;

create or replace function public.lifeline_cancel_appointments_for_closed_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('hospital_declined', 'cancelled', 'completed')
     and old.status is distinct from new.status then
    update public.donor_appointments
    set status = 'cancelled',
        donor_cancel_reason = coalesce(donor_cancel_reason, 'Request closed by the hospital.')
    where request_id = new.id and status = 'scheduled';
  end if;
  return new;
end
$$;

drop trigger if exists requests_cancel_scheduled_appointments on public.requests;
create trigger requests_cancel_scheduled_appointments
  after update of status on public.requests
  for each row execute function public.lifeline_cancel_appointments_for_closed_request();

create or replace function public.lifeline_process_expired_requests()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
  newly_changed integer;
  open_request_ttl constant interval := interval '48 hours';
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.requests
  set status = 'hospital_declined',
      hospital_response_timed_out = true,
      hospital_note = 'No response from the hospital within the review window. Choose another hospital to resend this request.',
      hospital_decision_at = now()
  where status = 'pending_hospital'
    and open_status_at <= now() - case when urgency::text = 'emergency'
      then interval '5 minutes' else interval '15 minutes' end;
  get diagnostics changed = row_count;

  update public.requests
  set status = 'cancelled'
  where status in ('pending_hospital', 'pending')
    and open_status_at <= now() - open_request_ttl;
  get diagnostics newly_changed = row_count;
  changed := changed + newly_changed;
  return changed;
end
$$;

revoke all on function public.lifeline_process_expired_requests() from PUBLIC, anon, authenticated;
grant execute on function public.lifeline_process_expired_requests() to service_role;

-- pg_cron is optional. Without it, invoke lifeline_process_expired_requests()
-- from an authorized service-role scheduler at least once per minute.
do $$
begin
  if to_regnamespace('cron') is not null
     and to_regprocedure('cron.schedule(text,text,text)') is not null
     and has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE') then
    execute $schedule$
      select cron.schedule(
        'lifeline-process-expired-requests',
        '* * * * *',
        'select public.lifeline_process_expired_requests()'
      )
      where not exists (
        select 1 from cron.job where jobname = 'lifeline-process-expired-requests'
      )
    $schedule$;
  end if;
exception
  when insufficient_privilege or undefined_table then
    raise notice 'pg_cron is installed but unavailable to this migration role; configure the documented service-role scheduler fallback.';
end
$$;

-- Patient-facing projections contain counts only; donor identity stays private.
drop view if exists public.patient_requests;
drop view if exists public.hospital_requests;
drop view if exists public.donor_calls;

create or replace view public.patient_requests
  with (security_barrier = true)
as
select r.id, r.blood_type, r.units, r.units_confirmed, r.urgency, r.status, r.created_at,
       r.hospital_id, h.name as hospital_name, h.address as hospital_address,
       r.hospital_note, r.hospital_decision_at, r.hospital_response_timed_out,
       (select count(*)::integer from public.donor_appointments a
        where a.request_id = r.id and a.status in ('scheduled', 'donated')) as volunteer_count
from public.requests r
join public.hospitals h on h.id = r.hospital_id
where r.patient_id = auth.uid()
  and public.lifeline_current_role() = 'patient';

create or replace view public.hospital_requests
  with (security_barrier = true)
as
select r.id, r.patient_id, r.blood_type, r.units, r.units_confirmed, r.urgency, r.status,
       r.created_at, r.hospital_id, r.hospital_note, r.hospital_decision_at,
       r.hospital_response_timed_out,
       (select count(*)::integer from public.donor_appointments a
        where a.request_id = r.id and a.status in ('scheduled', 'donated')) as volunteer_count,
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
select r.id, r.blood_type, r.units, r.units_confirmed, r.urgency, r.status, r.created_at,
       r.hospital_id, h.name as hospital_name, h.address as hospital_address,
       (select count(*)::integer from public.donor_appointments a
        where a.request_id = r.id and a.status in ('scheduled', 'donated')) as volunteer_count
from public.requests r
join public.hospitals h on h.id = r.hospital_id
join public.profiles volunteer
  on volunteer.id = auth.uid()
 and volunteer.role = 'donor'
 and volunteer.blood_type::text = r.blood_type::text
where public.lifeline_current_role() = 'donor'
  and (
    (r.status = 'pending' and volunteer.donor_status = 'active'
      and r.units_confirmed + (select count(*) from public.donor_appointments a
        where a.request_id = r.id and a.status = 'scheduled') < r.units)
    or exists (
      select 1 from public.donor_appointments a
      where a.request_id = r.id and a.donor_id = auth.uid()
        and a.status in ('scheduled', 'donated', 'deferred', 'no_show', 'cancelled')
    )
  );

revoke all on public.patient_requests, public.hospital_requests, public.donor_calls
  from PUBLIC, anon, authenticated;
grant select on public.patient_requests, public.hospital_requests, public.donor_calls
  to authenticated;

-- A donor's hospital thread is available only after a scheduled booking or
-- recorded outcome exists; patients still have no donor-to-patient path.
create or replace function public.lifeline_can_access_chat_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
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

-- Privacy and privilege assertions fail the migration if protected surfaces
-- accidentally become writable or patient-facing appointment rows are exposed.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.donor_appointments'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.donor_call_windows'::regclass) then
    raise exception 'Privacy check failed: appointment tables must have RLS enabled.';
  end if;
  if has_table_privilege('authenticated', 'public.donor_appointments', 'INSERT')
     or has_table_privilege('authenticated', 'public.donor_appointments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.donor_appointments', 'DELETE') then
    raise exception 'Privacy check failed: appointments must be changed only through guarded RPCs.';
  end if;
  if has_column_privilege('authenticated', 'public.requests', 'units_confirmed', 'UPDATE') then
    raise exception 'Privacy check failed: clients cannot change confirmed units.';
  end if;
  if has_table_privilege('authenticated', 'public.hospitals', 'INSERT')
     or has_table_privilege('authenticated', 'public.hospitals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.hospitals', 'DELETE') then
    raise exception 'Privacy check failed: hospital directory must be developer-managed.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_requests'
      and column_name in ('donor_id', 'donor_name', 'donor_phone', 'donor_address')
  ) then
    raise exception 'Privacy check failed: patient_requests exposes volunteer identity.';
  end if;
  if has_function_privilege('authenticated', 'public.lifeline_process_expired_requests()', 'EXECUTE') then
    raise exception 'Privilege check failed: authenticated users can run the timeout worker.';
  end if;
  if has_function_privilege('authenticated', 'public.lifeline_volunteer_for_call(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.lifeline_withdraw_from_call(uuid)', 'EXECUTE') then
    raise exception 'Privilege check failed: legacy single-donor response RPCs remain available.';
  end if;
end
$$;

-- Runtime negative checks (run as authenticated test accounts after migration):
-- 1. A donor must not select another donor's donor_appointments row.
-- 2. A patient must not select any donor_appointments row or donor_id.
-- 3. A hospital assigned to another hospital_id must be denied the outcome RPC.
-- 4. Concurrent booking calls for a request with one remaining unit: exactly one
--    succeeds; the other receives "All volunteer appointment places ... filled".
-- 5. A donor with a recent last_donated_at must be denied, even through direct RPC.
-- 6. A donor may cancel only their scheduled appointment; a valid cancellation
--    releases one place for a subsequent volunteer.
-- 7. A donor with an already recorded donation cannot book the same request again.
-- 8. After running the timeout worker, normal/emergency requests exceed 15/5
--    minutes become hospital_declined with hospital_response_timed_out=true.
-- 9. As a donor, select from public.donor_calls and verify it contains no
--    patient_id, donor_id, patient name, phone, address, or coordinates.
-- 10. As a patient, select from public.patient_requests and verify it contains
--    volunteer_count only; selecting public.donor_appointments returns no rows.
-- 11. As a donor, invoking lifeline_volunteer_for_call(request_id) must fail
--     with permission denied; use lifeline_book_donor_appointment instead.
