-- Account-specific negative checks.
-- Replace each <..._UUID> token with a real Supabase Auth user UUID before
-- running that block. Run blocks separately; each transaction rolls back.
-- These checks need fixtures: each account must have at least one related row
-- and the non-involved hospital checks need a report/audit row for another
-- hospital.

-- As a donor: cannot read patient identities or patient request rows.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<DONOR_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare protected_column_denied boolean := false;
begin
  begin
    execute 'select patient_id from public.requests limit 1';
  exception when insufficient_privilege then
    protected_column_denied := true;
  end;
  if not protected_column_denied then
    raise exception 'Negative check failed: donor could select requests.patient_id.';
  end if;
  if exists (select 1 from public.profiles where role = 'patient') then
    raise exception 'Negative check failed: donor could read another profile.';
  end if;
  if exists (select 1 from public.patient_requests) then
    raise exception 'Negative check failed: donor could read patient requests.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'donor_calls'
      and column_name in ('patient_id', 'patient_name', 'patient_phone', 'patient_address')
  ) then
    raise exception 'Negative check failed: donor_calls exposes patient identity.';
  end if;
end
$check$;
rollback;

-- As a patient: cannot read donor identities or appointment rows.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<PATIENT_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare protected_column_denied boolean := false;
begin
  begin
    execute 'select donor_id from public.requests limit 1';
  exception when insufficient_privilege then
    protected_column_denied := true;
  end;
  if not protected_column_denied then
    raise exception 'Negative check failed: patient could select requests.donor_id.';
  end if;
  if exists (select 1 from public.profiles where role = 'donor') then
    raise exception 'Negative check failed: patient could read another profile.';
  end if;
  if exists (select 1 from public.donor_appointments) then
    raise exception 'Negative check failed: patient could read donor appointments.';
  end if;
end
$check$;
rollback;

-- As a hospital user who is not assigned to the fixture hospital: no reports
-- or audit rows for that other hospital should be visible.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<OTHER_HOSPITAL_USER_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
begin
  if exists (
    select 1 from public.abuse_reports
    where hospital_id = '<FIXTURE_HOSPITAL_UUID>'::uuid
  ) then
    raise exception 'Negative check failed: non-involved hospital read a report.';
  end if;
  if exists (
    select 1 from public.request_audit_events
    where hospital_id = '<FIXTURE_HOSPITAL_UUID>'::uuid
  ) then
    raise exception 'Negative check failed: non-involved hospital read audit events.';
  end if;
end
$check$;
rollback;

-- As either a patient or donor: client code cannot create any chat thread,
-- including a patient-to-donor thread.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<PATIENT_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare direct_insert_denied boolean := false;
begin
  begin
    insert into public.chat_threads
      (request_id, hospital_id, thread_type, participant_id)
    values (
      '<FIXTURE_REQUEST_UUID>'::uuid,
      '<FIXTURE_HOSPITAL_UUID>'::uuid,
      'patient_donor',
      '<DONOR_UUID>'::uuid
    );
  exception when insufficient_privilege or check_violation then
    direct_insert_denied := true;
  end;
  if not direct_insert_denied then
    raise exception 'Negative check failed: client created a patient-to-donor thread.';
  end if;
end
$check$;
rollback;
