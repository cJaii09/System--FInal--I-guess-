-- Donor consent, pre-check flags and a database-enforced 56-day cooldown.

alter table public.profiles
  add column if not exists consent_at timestamptz,
  add column if not exists consent_version text,
  add column if not exists last_donated_at timestamptz;

alter table public.requests
  add column if not exists volunteer_ethics_acknowledged boolean not null default false;

create table if not exists public.donor_prechecks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  donor_id uuid not null references public.profiles(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete restrict,
  age_18_or_older boolean not null,
  weight_50kg_or_more boolean not null,
  feeling_well boolean not null,
  recent_illness boolean not null,
  recent_tattoo boolean not null,
  recent_travel boolean not null,
  medication boolean not null,
  recent_donation boolean not null,
  created_at timestamptz not null default now(),
  unique (request_id, donor_id)
);

create index if not exists donor_prechecks_hospital_request_idx
  on public.donor_prechecks(hospital_id, request_id);

alter table public.donor_prechecks enable row level security;
revoke all on public.donor_prechecks from PUBLIC, anon, authenticated;
grant select on public.donor_prechecks to authenticated;
grant all on public.donor_prechecks to service_role;

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
      select 1 from public.requests r
      where r.id = p_request_id
        and r.hospital_id = p_hospital_id
        and r.donor_id = p_donor_id
        and r.status in ('accepted', 'completed')
    )
$$;

revoke all on function public.lifeline_can_read_donor_precheck(uuid, uuid, uuid)
  from PUBLIC, anon;
grant execute on function public.lifeline_can_read_donor_precheck(uuid, uuid, uuid)
  to authenticated;

drop policy if exists donor_prechecks_read_participants on public.donor_prechecks;
create policy donor_prechecks_read_participants on public.donor_prechecks
  for select to authenticated
  using (
    donor_id = auth.uid()
    or public.lifeline_can_read_donor_precheck(request_id, hospital_id, donor_id)
  );

create or replace function public.lifeline_record_signup_donor_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'donor' and exists (
    select 1 from auth.users u
    where u.id = new.id
      and u.raw_user_meta_data ->> 'donor_consent_accepted' = 'true'
      and u.raw_user_meta_data ->> 'donor_consent_version' = '2026-10-v1'
  ) then
    update public.profiles
    set consent_at = coalesce(consent_at, now()),
        consent_version = '2026-10-v1'
    where id = new.id;
  end if;
  return new;
end
$$;

drop trigger if exists profiles_record_signup_donor_consent on public.profiles;
create trigger profiles_record_signup_donor_consent
  after insert on public.profiles
  for each row execute function public.lifeline_record_signup_donor_consent();

create or replace function public.lifeline_accept_donor_consent(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare accepted_at timestamptz;
begin
  if auth.uid() is null
     or public.lifeline_current_role() <> 'donor'
     or p_version <> '2026-10-v1' then
    raise exception 'Donor consent could not be recorded. Please review the statement and try again.';
  end if;

  update public.profiles
  set consent_at = now(), consent_version = p_version
  where id = auth.uid() and role = 'donor'
  returning consent_at into accepted_at;

  if accepted_at is null then
    raise exception 'Donor consent could not be recorded. Please try again.';
  end if;
  return accepted_at;
end
$$;

revoke all on function public.lifeline_accept_donor_consent(text) from PUBLIC, anon;
grant execute on function public.lifeline_accept_donor_consent(text) to authenticated;

create or replace function public.lifeline_require_patient_ethics_acknowledgement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and new.volunteer_ethics_acknowledged is not true then
    raise exception 'Please confirm the voluntary, unpaid donation notice before sending this request.';
  end if;
  return new;
end
$$;

drop trigger if exists requests_require_patient_ethics_acknowledgement on public.requests;
create trigger requests_require_patient_ethics_acknowledgement
  before insert on public.requests
  for each row execute function public.lifeline_require_patient_ethics_acknowledgement();

grant insert (volunteer_ethics_acknowledged) on public.requests to authenticated;

create or replace function public.lifeline_save_donor_precheck(
  p_request_id uuid,
  p_age_18_or_older boolean,
  p_weight_50kg_or_more boolean,
  p_feeling_well boolean,
  p_recent_illness boolean,
  p_recent_tattoo boolean,
  p_recent_travel boolean,
  p_medication boolean,
  p_last_donation_date date,
  p_never_donated boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  donor public.profiles%rowtype;
  call_row public.requests%rowtype;
  donation_recent boolean;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'donor' then
    raise exception 'Only donors can complete this pre-check.';
  end if;
  if p_age_18_or_older is null or p_weight_50kg_or_more is null
     or p_feeling_well is null or p_recent_illness is null
     or p_recent_tattoo is null or p_recent_travel is null
     or p_medication is null or p_never_donated is null
     or (p_never_donated and p_last_donation_date is not null)
     or (not p_never_donated and p_last_donation_date is null)
     or p_last_donation_date > current_date then
    raise exception 'Please complete each pre-check answer.';
  end if;

  select * into donor from public.profiles
  where id = auth.uid() and role = 'donor';
  if donor.consent_at is null or donor.consent_version <> '2026-10-v1' then
    raise exception 'Review and accept the donor consent statement before volunteering.';
  end if;
  if donor.last_donated_at is not null
     and (donor.last_donated_at at time zone 'UTC')::date >
         (now() at time zone 'UTC')::date - 56 then
    raise exception 'You can volunteer again on ' ||
      to_char((donor.last_donated_at at time zone 'UTC')::date + 56, 'FMMonth FMDD, YYYY') || '.';
  end if;

  select * into call_row from public.requests
  where id = p_request_id
    and status = 'pending'
    and donor_id is null
    and blood_type::text = donor.blood_type::text;
  if call_row.id is null then
    raise exception 'This hospital call is no longer available to your account.';
  end if;

  donation_recent :=
    (not p_never_donated and p_last_donation_date > current_date - 56)
    or (donor.last_donated_at is not null
        and (donor.last_donated_at at time zone 'UTC')::date >
            (now() at time zone 'UTC')::date - 56);

  insert into public.donor_prechecks (
    request_id, donor_id, hospital_id, age_18_or_older, weight_50kg_or_more,
    feeling_well, recent_illness, recent_tattoo, recent_travel, medication, recent_donation
  ) values (
    call_row.id, auth.uid(), call_row.hospital_id, p_age_18_or_older, p_weight_50kg_or_more,
    p_feeling_well, p_recent_illness, p_recent_tattoo, p_recent_travel,
    p_medication, donation_recent
  )
  on conflict (request_id, donor_id) do update set
    hospital_id = excluded.hospital_id,
    age_18_or_older = excluded.age_18_or_older,
    weight_50kg_or_more = excluded.weight_50kg_or_more,
    feeling_well = excluded.feeling_well,
    recent_illness = excluded.recent_illness,
    recent_tattoo = excluded.recent_tattoo,
    recent_travel = excluded.recent_travel,
    medication = excluded.medication,
    recent_donation = excluded.recent_donation,
    created_at = now();

  if p_age_18_or_older and p_weight_50kg_or_more and p_feeling_well
     and not p_recent_illness and not p_recent_tattoo and not p_recent_travel
     and not p_medication and not donation_recent then
    return 'Pre-check passed';
  end if;
  return 'Please ask the hospital';
end
$$;

revoke all on function public.lifeline_save_donor_precheck(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, date, boolean
) from PUBLIC, anon;
grant execute on function public.lifeline_save_donor_precheck(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, date, boolean
) to authenticated;

create or replace function public.lifeline_volunteer_for_call(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  donor public.profiles%rowtype;
  affected integer;
begin
  if auth.uid() is null or public.lifeline_current_role() <> 'donor' then
    raise exception 'Only donors can volunteer for a hospital call.';
  end if;

  select * into donor from public.profiles where id = auth.uid() and role = 'donor';
  if donor.consent_at is null or donor.consent_version <> '2026-10-v1' then
    raise exception 'Review and accept the donor consent statement before volunteering.';
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
    raise exception 'Complete a passing pre-check before volunteering. The hospital makes the final medical decision.';
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
         and (p.last_donated_at is null
           or (p.last_donated_at at time zone 'UTC')::date <=
              (now() at time zone 'UTC')::date - 56)
         and p.consent_at is not null
         and p.consent_version = '2026-10-v1'
     );

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

revoke all on function public.lifeline_volunteer_for_call(uuid) from PUBLIC, anon;
grant execute on function public.lifeline_volunteer_for_call(uuid) to authenticated;

create or replace function public.lifeline_admin_set_last_donated_at(
  p_donor_id uuid,
  p_last_donated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Only an authorized administrator can record a confirmed donation.';
  end if;
  if p_last_donated_at is null or p_last_donated_at > now() then
    raise exception 'Use a valid confirmed donation date.';
  end if;

  update public.profiles
  set last_donated_at = p_last_donated_at
  where id = p_donor_id and role = 'donor';
  if not found then
    raise exception 'The donor profile was not found.';
  end if;
end
$$;

revoke all on function public.lifeline_admin_set_last_donated_at(uuid, timestamptz)
  from PUBLIC, anon, authenticated;
grant execute on function public.lifeline_admin_set_last_donated_at(uuid, timestamptz)
  to service_role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.donor_prechecks'::regclass) then
    raise exception 'Privacy check failed: donor_prechecks must have RLS enabled.';
  end if;
  if has_table_privilege('authenticated', 'public.donor_prechecks', 'INSERT')
     or has_table_privilege('authenticated', 'public.donor_prechecks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.donor_prechecks', 'DELETE') then
    raise exception 'Privacy check failed: donor pre-check writes must use the guarded RPC.';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'last_donated_at', 'UPDATE') then
    raise exception 'Privacy check failed: donors can update last_donated_at.';
  end if;
  if has_function_privilege('authenticated',
      'public.lifeline_admin_set_last_donated_at(uuid,timestamptz)', 'EXECUTE') then
    raise exception 'Privacy check failed: donors can execute the admin donation function.';
  end if;
  if has_function_privilege('authenticated',
      'public.lifeline_volunteer_for_call(uuid)', 'EXECUTE') is false then
    raise exception 'Privacy check failed: donor volunteer RPC is not available.';
  end if;
end
$$;

-- Manual negative checks after applying this migration (replace UUIDs):
-- 1. As a donor with no consent, call lifeline_volunteer_for_call(request_id);
--    it must raise "Review and accept the donor consent statement".
-- 2. As a donor whose last_donated_at is less than 56 days old, call the same
--    RPC; it must raise "You can volunteer again on <date>".
-- 3. As a donor, call lifeline_admin_set_last_donated_at(...); EXECUTE must be
--    denied, and direct UPDATE of profiles.last_donated_at must be denied.
-- 4. As a patient, insert a request with volunteer_ethics_acknowledged=false;
--    the insert must fail. With true, it must succeed under patient request RLS.
-- 5. A donor must not see another donor's pre-check; a hospital must not see
--    one until that donor has an accepted/completed request at that hospital.
