-- RPC negative checks. Replace every <..._UUID> and run each transaction
-- separately as a migrated Supabase project. Fixtures must satisfy the stated
-- preconditions so each test reaches the guard being tested.

-- Donor has no current consent; request is open, active, and blood-type matched.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<DONOR_WITHOUT_CONSENT_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare blocked boolean := false;
begin
  begin
    perform public.lifeline_book_donor_appointment(
      '<OPEN_MATCHING_REQUEST_UUID>'::uuid, now() + interval '1 day'
    );
  exception when raise_exception then
    if sqlerrm like '%consent%' then blocked := true; else raise; end if;
  end;
  if not blocked then
    raise exception 'Negative check failed: donor without consent could volunteer.';
  end if;
end
$check$;
rollback;

-- Donor has current consent and last_donated_at within 56 days; request is open
-- and blood-type matched. The cooldown is checked before pre-check/window data.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<RECENTLY_DONATED_DONOR_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare blocked boolean := false;
begin
  begin
    perform public.lifeline_book_donor_appointment(
      '<OPEN_MATCHING_REQUEST_UUID>'::uuid, now() + interval '1 day'
    );
  exception when raise_exception then
    if sqlerrm like '%volunteer again on%' then blocked := true; else raise; end if;
  end;
  if not blocked then
    raise exception 'Negative check failed: donor inside the cooldown could volunteer.';
  end if;
end
$check$;
rollback;

-- This scheduled appointment belongs to a different hospital than the
-- authenticated hospital account.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<WRONG_HOSPITAL_USER_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare blocked boolean := false;
begin
  begin
    perform public.lifeline_record_appointment_outcome(
      '<OTHER_HOSPITAL_SCHEDULED_APPOINTMENT_UUID>'::uuid, 'donated', null
    );
  exception when raise_exception then
    if sqlerrm like '%not scheduled at your hospital%' then blocked := true; else raise; end if;
  end;
  if not blocked then
    raise exception 'Negative check failed: a non-involved hospital recorded an outcome.';
  end if;
end
$check$;
rollback;

-- A suspended donor with consent, a valid pre-check, an open matching request,
-- capacity, and an in-window slot reaches the appointment suspension trigger.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<SUSPENDED_DONOR_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare blocked boolean := false;
begin
  begin
    perform public.lifeline_book_donor_appointment(
      '<ELIGIBLE_OPEN_REQUEST_UUID>'::uuid, '<VALID_SLOT_START_ISO>'::timestamptz
    );
  exception when raise_exception then
    if sqlerrm like '%suspended%' then blocked := true; else raise; end if;
  end;
  if not blocked then
    raise exception 'Negative check failed: suspended donor booked an appointment.';
  end if;
end
$check$;
rollback;

-- The authenticated user is a suspended patient; the seeded hospital UUID is
-- valid and the ethics acknowledgement is true, so the suspension guard is
-- the expected rejection.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<SUSPENDED_PATIENT_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
declare blocked boolean := false;
begin
  begin
    insert into public.requests
      (patient_id, blood_type, units, urgency, status, hospital_id,
       volunteer_ethics_acknowledged)
    values (
      auth.uid(), 'A+', 1, 'normal', 'pending_hospital',
      '<APPROVED_HOSPITAL_UUID>'::uuid, true
    );
  exception when raise_exception then
    if sqlerrm like '%suspended%' then blocked := true; else raise; end if;
  end;
  if not blocked then
    raise exception 'Negative check failed: suspended patient created a request.';
  end if;
end
$check$;
rollback;

-- For the timeout check, use a disposable pending_hospital fixture. This block
-- is intended for the database owner/service role, not authenticated users.
begin;
update public.requests
set open_status_at = now() - interval '16 minutes'
where id = '<NORMAL_PENDING_HOSPITAL_REQUEST_UUID>'::uuid
  and status = 'pending_hospital'
  and urgency <> 'emergency';
select public.lifeline_process_expired_requests();
do $check$
begin
  if not exists (
    select 1 from public.requests
    where id = '<NORMAL_PENDING_HOSPITAL_REQUEST_UUID>'::uuid
      and status = 'hospital_declined'
      and hospital_response_timed_out is true
  ) then
    raise exception 'Negative check failed: expired hospital request was not flagged.';
  end if;
end
$check$;
rollback;

-- Cancellation positive/release check: replace with a donor-owned scheduled
-- appointment on a request that still has capacity. The rollback restores it.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<SCHEDULED_DONOR_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
begin
  if not public.lifeline_cancel_donor_appointment(
    '<DONOR_OWNED_SCHEDULED_APPOINTMENT_UUID>'::uuid,
    'Unable to attend this time'
  ) then
    raise exception 'Cancellation did not complete.';
  end if;
  if not exists (
    select 1 from public.donor_appointments
    where id = '<DONOR_OWNED_SCHEDULED_APPOINTMENT_UUID>'::uuid
      and status = 'cancelled'
  ) then
    raise exception 'Cancellation did not release the scheduled appointment.';
  end if;
end
$check$;
rollback;
