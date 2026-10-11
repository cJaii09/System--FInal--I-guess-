# Supabase SQL checks

Run `00_schema_assertions.sql` as a database role able to inspect the schema,
after the project's baseline schema and migrations `005` through `010` have
been applied. A successful run returns `schema assertions passed`.

The remaining SQL files are integration-test templates because their UUIDs
belong to each Supabase deployment. Replace every `<..._UUID>` and timestamp
placeholder with disposable, purpose-prepared fixtures before running them.
Do not use real patient or donor accounts for destructive setup.

`01_privacy_rls_negative_checks.sql` must be run as the stated authenticated
roles and checks identity boundaries, non-involved hospital isolation, and
prohibition on client-created patient-to-donor threads. Ensure the fixtures
include a related request and report/audit rows for another hospital, or a
passing zero-row assertion would be vacuous.

`02_workflow_negative_checks.sql` exercises consent, cooldown, wrong-hospital
outcome, suspension, timeout, and donor cancellation guards. Its comments state
the fixture preconditions required for each assertion to reach the intended
guard. The timeout block must be run as the database owner/service role.

For the overbooking race, use two concurrent, persistent database sessions:
run session A, then start session B while A's transaction remains open. Session
B should block on the request lock. Commit A; B must then fail because the one
remaining place is filled. Use donors with current consent, passing pre-checks,
no cooldown, and valid slots in the hospital's configured window. The SQL
Editor may automatically close transactions, so use `psql` or another client
that supports two held transactions for this test.

These scripts were not run against a live Supabase database in this workspace.
The test report must treat them as unverified until they are executed against
the intended project with the required test fixtures.
