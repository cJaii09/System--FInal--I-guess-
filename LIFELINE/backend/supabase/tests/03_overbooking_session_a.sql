-- Two-session race test, session A.
-- Use a disposable request with exactly one remaining volunteer place and
-- an eligible donor fixture. Run this in a persistent SQL session. Do not
-- commit yet; session B's booking call should block on the request row lock.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<ELIGIBLE_DONOR_A_UUID>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.lifeline_book_donor_appointment(
  '<ONE_PLACE_REMAINING_REQUEST_UUID>'::uuid,
  '<VALID_SLOT_A_ISO>'::timestamptz
);
-- After session B is waiting, run COMMIT in this session.
