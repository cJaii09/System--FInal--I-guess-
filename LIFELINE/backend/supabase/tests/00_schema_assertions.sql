-- Run after migrations 005 through 010 using a database role that can inspect
-- the public schema. Any failed assertion raises an error and stops the script.
do $checks$
declare
  table_name text;
  rls_enabled boolean;
begin
  foreach table_name in array array[
    'hospitals', 'profiles', 'requests', 'request_events',
    'donor_prechecks', 'donor_call_windows', 'donor_appointments',
    'chat_threads', 'chat_messages', 'abuse_reports', 'request_audit_events'
  ] loop
    select c.relrowsecurity into rls_enabled
    from pg_class c
    where c.oid = to_regclass(format('public.%I', table_name));
    if rls_enabled is distinct from true then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
  end loop;

  if has_column_privilege('authenticated', 'public.requests', 'patient_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'donor_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'patient_lat', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'patient_lng', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'donor_lat', 'SELECT')
     or has_column_privilege('authenticated', 'public.requests', 'donor_lng', 'SELECT') then
    raise exception 'Authenticated clients can select protected request identity/location columns.';
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'last_donated_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'hospital_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then
    raise exception 'Authenticated clients can edit protected profile fields.';
  end if;

  if has_table_privilege('authenticated', 'public.hospitals', 'INSERT')
     or has_table_privilege('authenticated', 'public.hospitals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.hospitals', 'DELETE') then
    raise exception 'Authenticated clients can modify the developer-managed hospital directory.';
  end if;

  if has_table_privilege('authenticated', 'public.donor_appointments', 'INSERT')
     or has_table_privilege('authenticated', 'public.donor_appointments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.donor_appointments', 'DELETE')
     or has_table_privilege('authenticated', 'public.chat_threads', 'INSERT') then
    raise exception 'A guarded table has a direct client write grant.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'donor_calls'
      and column_name in ('patient_id', 'patient_name', 'patient_phone',
        'patient_address', 'patient_lat', 'patient_lng', 'patient',
        'donor_id', 'donor_name', 'donor_phone', 'donor')
  ) then
    raise exception 'The donor_calls view exposes a donor or patient identity field.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_requests'
      and column_name in ('donor_id', 'donor_name', 'donor_phone',
        'donor_address', 'donor_lat', 'donor_lng')
  ) then
    raise exception 'The patient_requests view exposes a volunteer identity field.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_threads'::regclass
      and conname = 'chat_threads_phase4_allowed_type_check'
  ) then
    raise exception 'The patient/hospital and donor/hospital thread constraint is missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.chat_messages'::regclass
      and tgname = 'chat_messages_rate_limit' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.requests'::regclass
      and tgname = 'requests_require_active_account' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.donor_appointments'::regclass
      and tgname = 'donor_appointments_guard_suspended_donor' and not tgisinternal
  ) then
    raise exception 'A message rate-limit or suspension trigger is missing.';
  end if;
end
$checks$;

select 'schema assertions passed' as result;
