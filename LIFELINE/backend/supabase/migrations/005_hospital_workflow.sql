-- Hospital-first request workflow. Run after the existing profiles/requests schema.
create table if not exists public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  phone text,
  lat double precision,
  lng double precision,
  is_approved boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.hospitals (id, name, address, phone, lat, lng, is_approved, is_active)
values
  ('10000000-0000-4000-8000-000000000001', 'Kenyatta National Hospital', 'Hospital Road, Upper Hill, Nairobi', '+254 20 2726300', -1.3008, 36.8069, true, true),
  ('10000000-0000-4000-8000-000000000002', 'MP Shah Hospital', 'Shivachi Road, Parklands, Nairobi', '+254 20 4291000', -1.2635, 36.8147, true, true),
  ('10000000-0000-4000-8000-000000000003', 'Aga Khan University Hospital', '3rd Parklands Avenue, Nairobi', '+254 20 3662000', -1.2571, 36.8154, true, true),
  ('10000000-0000-4000-8000-000000000004', 'The Nairobi Hospital', 'Argwings Kodhek Road, Nairobi', '+254 703 082000', -1.2988, 36.8031, true, true),
  ('10000000-0000-4000-8000-000000000005', 'Demo Unapproved Hospital', 'Nairobi', null, null, null, false, true)
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  phone = excluded.phone,
  lat = excluded.lat,
  lng = excluded.lng;

alter table public.hospitals enable row level security;
drop policy if exists hospitals_read_approved on public.hospitals;
create policy hospitals_read_approved on public.hospitals
  for select to anon, authenticated
  using (is_approved);
revoke insert, update, delete on public.hospitals from anon, authenticated;
grant select on public.hospitals to anon, authenticated;
grant select, insert, update, delete on public.hospitals to service_role;

alter table public.profiles
  add column if not exists hospital_id uuid references public.hospitals(id) on delete restrict;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role type text using role::text;
alter table public.profiles alter column role set default 'patient';
alter table public.profiles
  add constraint profiles_role_check check (role in ('patient', 'donor', 'hospital'));
alter table public.profiles
  add constraint profiles_hospital_required_check
  check (role <> 'hospital' or hospital_id is not null);

alter table public.requests
  add column if not exists hospital_id uuid references public.hospitals(id) on delete restrict,
  add column if not exists hospital_note text,
  add column if not exists hospital_decision_at timestamptz;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'requests'
  loop
    execute format('drop policy %I on public.requests', p.policyname);
  end loop;
end $$;

alter table public.requests alter column status drop default;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.requests'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.requests alter column status type text using status::text;
alter table public.requests alter column status set default 'pending_hospital';
alter table public.requests
  add constraint requests_status_check
  check (status in ('pending_hospital', 'pending', 'accepted', 'completed',
                    'hospital_declined', 'declined', 'cancelled'));

-- Route matching legacy free-text hospitals where possible. Unmatched open
-- requests are returned to their patient for choosing an approved hospital.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'requests' and column_name = 'hospital'
  ) then
    execute $query$
      update public.requests r
      set hospital_id = h.id
      from public.hospitals h
      where r.hospital_id is null and r.hospital = h.name
    $query$;
  end if;
end $$;
update public.requests
set status = case when hospital_id is null then 'hospital_declined' else 'pending_hospital' end,
    hospital_note = case when hospital_id is null
      then 'Please choose an approved hospital to resubmit this request.' else hospital_note end
where status = 'pending';

create or replace function public.lifeline_current_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.lifeline_current_hospital_id()
returns uuid language sql stable security definer set search_path = public
as $$ select hospital_id from public.profiles where id = auth.uid() $$;

create or replace function public.lifeline_current_blood_type()
returns text language sql stable security definer set search_path = public
as $$ select blood_type::text from public.profiles where id = auth.uid() $$;

revoke all on function public.lifeline_current_role() from public;
revoke all on function public.lifeline_current_hospital_id() from public;
revoke all on function public.lifeline_current_blood_type() from public;
grant execute on function public.lifeline_current_role() to authenticated;
grant execute on function public.lifeline_current_hospital_id() to authenticated;
grant execute on function public.lifeline_current_blood_type() to authenticated;

create or replace function public.lifeline_guard_profile_role_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.hospital_id is distinct from old.hospital_id)
    and auth.role() is distinct from 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Only developers may change a profile role or hospital assignment';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_role_update on public.profiles;
create trigger profiles_guard_role_update before update on public.profiles
  for each row execute function public.lifeline_guard_profile_role_update();

create or replace function public.lifeline_guard_request_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare app_role text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  app_role := public.lifeline_current_role();

  if app_role = 'hospital' and old.hospital_id = public.lifeline_current_hospital_id() then
    if old.status <> 'pending_hospital'
      or new.status not in ('pending', 'hospital_declined')
      or (to_jsonb(new) - array['status', 'hospital_note', 'hospital_decision_at'])
         is distinct from
         (to_jsonb(old) - array['status', 'hospital_note', 'hospital_decision_at']) then
      raise exception 'Hospitals may only approve or decline their incoming requests';
    end if;
    new.hospital_decision_at := now();
    return new;
  end if;

  if app_role = 'patient' and old.patient_id = auth.uid() then
    if (to_jsonb(new) - array['blood_type', 'units', 'urgency', 'hospital_id',
        'hospital_note', 'hospital_decision_at', 'status', 'patient_lat', 'patient_lng'])
       is distinct from
       (to_jsonb(old) - array['blood_type', 'units', 'urgency', 'hospital_id',
        'hospital_note', 'hospital_decision_at', 'status', 'patient_lat', 'patient_lng']) then
      raise exception 'Patients may only edit their own request details';
    end if;
    if not (old.status in ('hospital_declined', 'declined', 'cancelled')
            and new.status = 'pending_hospital')
      and (new.hospital_note is distinct from old.hospital_note
           or new.hospital_decision_at is distinct from old.hospital_decision_at) then
      raise exception 'Only hospitals may change the hospital note';
    end if;
    if old.status = 'hospital_declined' and new.status = 'pending_hospital' then
      if new.hospital_id is null or not exists (
        select 1 from public.hospitals h
        where h.id = new.hospital_id and h.is_approved and h.is_active
      ) then
        raise exception 'Choose an approved, active hospital';
      end if;
      new.hospital_note := null;
      new.hospital_decision_at := null;
    elsif old.status in ('declined', 'cancelled') and new.status = 'pending_hospital' then
      if new.hospital_id is distinct from old.hospital_id or new.hospital_id is null
        or not exists (
          select 1 from public.hospitals h
          where h.id = new.hospital_id and h.is_approved and h.is_active
        ) then
        raise exception 'Choose an approved, active hospital to reopen this request';
      end if;
      new.hospital_note := null;
      new.hospital_decision_at := null;
    elsif old.status = 'pending' and new.status = 'cancelled' then
      if new.hospital_id is distinct from old.hospital_id then
        raise exception 'Patients cannot change the hospital without a new review';
      end if;
    elsif old.status = 'pending_hospital' and new.status = 'cancelled' then
      if new.hospital_id is distinct from old.hospital_id then
        raise exception 'Patients cannot change the hospital without a new review';
      end if;
    elsif old.status = 'pending' and new.status = 'pending' then
      if new.hospital_id is distinct from old.hospital_id then
        raise exception 'Patients cannot change the hospital without a new review';
      end if;
    elsif old.status = 'accepted' and new.status = 'accepted' then
      if new.hospital_id is distinct from old.hospital_id then
        raise exception 'Patients cannot change the hospital without a new review';
      end if;
    elsif old.status = 'accepted' and new.status = 'completed' then
      if new.hospital_id is distinct from old.hospital_id then
        raise exception 'Patients cannot change the hospital without a new review';
      end if;
    else
      raise exception 'This request cannot be changed in its current state';
    end if;
    return new;
  end if;

  if app_role = 'donor' and (
    (old.status = 'pending' and old.blood_type::text = public.lifeline_current_blood_type())
    or (old.status = 'accepted' and old.donor_id = auth.uid())
  ) then
    if (to_jsonb(new) - array['status', 'donor_id', 'declined_by', 'donor_lat', 'donor_lng'])
       is distinct from
       (to_jsonb(old) - array['status', 'donor_id', 'declined_by', 'donor_lat', 'donor_lng']) then
      raise exception 'Donors may only respond to matching requests';
    end if;
    if not (
      (old.status = 'pending' and new.status = 'pending' and new.donor_id is null)
      or (old.status = 'pending' and new.status = 'accepted' and new.donor_id = auth.uid())
      or (old.status = 'accepted' and old.donor_id = auth.uid()
          and new.status = 'pending' and new.donor_id is null)
      or (old.status = 'accepted' and old.donor_id = auth.uid()
          and new.status = 'accepted' and new.donor_id = auth.uid())
    ) then
      raise exception 'This request cannot be changed in its current state';
    end if;
    if old.status = 'pending' and new.status = 'pending'
      and (select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
           from jsonb_array_elements(coalesce(to_jsonb(old)->'declined_by', '[]'::jsonb))
                with ordinality as old_declines(value, ordinal)
           where value <> to_jsonb(auth.uid()::text))
         is distinct from
        (select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
         from jsonb_array_elements(coalesce(to_jsonb(new)->'declined_by', '[]'::jsonb))
              with ordinality as new_declines(value, ordinal)
         where value <> to_jsonb(auth.uid()::text)) then
      raise exception 'Donors may only change their own decline status';
    end if;
    return new;
  end if;

  raise exception 'You are not allowed to update this request';
end $$;

drop trigger if exists requests_guard_update on public.requests;
create trigger requests_guard_update before update on public.requests
  for each row execute function public.lifeline_guard_request_update();

alter table public.requests enable row level security;
alter table public.requests replica identity full;

create policy requests_read_patient on public.requests
  for select to authenticated
  using (patient_id = auth.uid() and public.lifeline_current_role() = 'patient');
create policy requests_read_hospital on public.requests
  for select to authenticated
  using (hospital_id = public.lifeline_current_hospital_id()
         and public.lifeline_current_role() = 'hospital');
create policy requests_read_donor on public.requests
  for select to authenticated
  using (((status = 'pending' and blood_type::text = public.lifeline_current_blood_type())
         or (status in ('accepted', 'completed') and donor_id = auth.uid()
             and blood_type::text = public.lifeline_current_blood_type()))
         and public.lifeline_current_role() = 'donor');

create policy requests_create_patient on public.requests
  for insert to authenticated
  with check (patient_id = auth.uid()
              and public.lifeline_current_role() = 'patient'
              and status = 'pending_hospital'
              and exists (
                select 1 from public.hospitals h
                where h.id = hospital_id and h.is_approved and h.is_active
              ));

create policy requests_update_patient on public.requests
  for update to authenticated
  using (patient_id = auth.uid() and public.lifeline_current_role() = 'patient')
  with check (patient_id = auth.uid() and public.lifeline_current_role() = 'patient');
create policy requests_update_hospital on public.requests
  for update to authenticated
  using (hospital_id = public.lifeline_current_hospital_id()
         and public.lifeline_current_role() = 'hospital')
  with check (hospital_id = public.lifeline_current_hospital_id()
              and public.lifeline_current_role() = 'hospital');
create policy requests_update_donor on public.requests
  for update to authenticated
  using ((status = 'pending' and blood_type::text = public.lifeline_current_blood_type())
         or (donor_id = auth.uid() and status = 'accepted'))
  with check (blood_type::text = public.lifeline_current_blood_type()
              and ((status = 'pending' and donor_id is null)
                   or (status = 'accepted' and donor_id = auth.uid())));

grant select, insert, update on public.requests to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'requests'
    ) then
    alter publication supabase_realtime add table public.requests;
  end if;
end $$;
