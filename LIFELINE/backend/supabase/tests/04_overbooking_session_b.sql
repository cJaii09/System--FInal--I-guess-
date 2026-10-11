-- Two-session race test, session B.
-- Start this while session A (03_overbooking_session_a.sql) has booked but
-- not committed. It should wait for session A, then fail with the capacity
-- message after A commits. If session A rolls back, this booking may succeed.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<ELIGIBLE_DONOR_B_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.lifeline_book_donor_appointment(
  '<ONE_PLACE_REMAINING_REQUEST_UUID>'::uuid,
  '<VALID_SLOT_B_ISO>'::timestamptz
);
-- Expected: "All volunteer appointment places for this call are filled."
rollback;
