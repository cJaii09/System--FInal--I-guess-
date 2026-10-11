# Changes and requirements traceability

This is a code-based summary of the current implementation, reconstructed from
the checked-in source tree and SQL migrations. It is not a version-control
change log: this workspace has no Git metadata, and the paper containing
FR-01–FR-15 was not present. The following functional requirement numbers
continue after FR-15; confirm their wording and mapping against the paper
before submitting it.

## Functional requirements (continuing after FR-15)

| ID | Requirement implemented |
| --- | --- |
| FR-16 | Patients select an approved, active hospital for a request. |
| FR-17 | A request remains private from donors until its hospital approves it. |
| FR-18 | Donors see anonymous calls and may book a hospital appointment after consent, self-check, and cooldown checks. |
| FR-19 | The hospital records appointment outcomes; patient progress exposes aggregate counts only. |
| FR-20 | The hospital can communicate with patients and booked volunteers; patient-to-donor chat is prohibited. |
| FR-21 | Role-scoped reports and audit records are available to the request's hospital. |
| FR-22 | Suspensions, message throttling, donor consent, and donation cooldowns have database-side enforcement. |
| FR-23 | LIA authenticates users, provides role-aware coordination help, and falls back to an offline FAQ. |

## New non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-01 | RLS and database grants, not UI hiding alone, enforce role and record boundaries. |
| NFR-02 | Donor and patient identity/contact data are excluded from the other role's UI views and realtime notification payloads. |
| NFR-03 | User-provided text is escaped or inserted through text-only DOM APIs before display. |
| NFR-04 | No API key, service-role key, or credential is required in the frontend. |
| NFR-05 | The app presents donation as voluntary and unpaid and does not claim to make medical or legal decisions. |
| NFR-06 | Backend tests use Node's built-in test runner; SQL checks are deployment-fixture-driven and documented. |

## Phase-to-file map

The map records where each phase is represented in the current tree. It does
not assert that every listed file was first created in that phase.

| Phase | Implementation areas and files |
| --- | --- |
| 1 — Remove marketplace behavior | `backend/supabase/migrations/007_privacy_redesign.sql`; `frontend/js/api.js`; `frontend/js/screens/home.js`, `requests.js`, `emergency.js`; `frontend/js/router.js`; `frontend/js/messages.js`; `frontend/js/chatbot.js` |
| 2 — Consent, self-check, ethics | `backend/supabase/migrations/008_consent_precheck_ethics.sql`; `frontend/js/api.js`, `auth.js`; `frontend/js/screens/auth.js`, `requests.js`, `profile.js`, `ethics.js`; `frontend/js/router.js` |
| 3 — Appointments and hospital control | `backend/supabase/migrations/009_hospital_appointments.sql`; `frontend/js/api.js`; `frontend/js/screens/requests.js`, `hospital.js`, `home.js`, `emergency.js`; `frontend/js/router.js` |
| 4 — Abuse, privacy, audit | `backend/supabase/migrations/010_abuse_privacy_audit.sql`; `frontend/js/api.js`, `messages.js`; `frontend/js/screens/requests.js`, `hospital.js`; `frontend/js/router.js`; `docs/PRIVACY.md` |
| 5 — LIA alignment | `backend/server.js`; `backend/.env.example`; `frontend/js/chatbot.js` |
| Shared hospital workflow and messaging | `backend/supabase/migrations/005_hospital_workflow.sql`, `006_messages.sql`; `frontend/js/api.js`, `auth.js`, `router.js`, `messages.js`, and role screens |
| 6 — Tests and documentation | Root `package.json`, `.gitignore`; `backend/server.js`; `backend/tests/chat.test.js`; `backend/supabase/tests/`; `README.md`; `docs/PROCESS_FLOW.md`, `docs/CHANGES.md`, `docs/DEFENSE_NOTES.md` |

## Screens represented

- Patient home, request list/create/detail, emergency request, profile, ethics,
  and hospital conversation.
- Donor home, hospital call list/detail, emergency calls, donor consent,
  self-check/appointment selection, profile, and hospital conversation.
- Hospital incoming request list, request review, volunteer call/slot
  management, appointment outcomes, conversations, reports, and audit view.
- Shared LIA assistant and in-app messages widgets.

## Database objects and policy areas

Migrations 005–010 add or extend `hospitals`, `profiles`, `requests`,
`request_events`, `chat_threads`, `chat_messages`, `donor_prechecks`,
`donor_call_windows`, `donor_appointments`, `abuse_reports`, and
`request_audit_events`. Role-scoped views include `patient_requests`,
`hospital_requests`, `donor_calls`, and `hospital_volunteer_registry`.

Policy/guard areas include approved hospital reads and service-role-only
directory writes; owner-only profiles; patient/hospital request access and
donor access only through an anonymous call view; recipient-scoped realtime
events; participant/hospital chat access; pre-check visibility to its donor
and assigned hospital; guarded appointment RPCs/capacity; hospital-only
reports and audit rows; and triggers/RPCs for consent, cooldown, suspension,
message rate limiting, and appointment outcomes.

## Test cases and current results

Actual results below are updated after running the available checks in this
workspace. SQL scenarios need Supabase fixtures and are not represented as
passed unless run against that database.

| Test ID | Scenario | Steps | Expected result | Actual result | Status |
| --- | --- | --- | --- | --- | --- |
| API-01 | Missing chat token | POST `/api/chat` without Authorization | HTTP 401 | HTTP 401; passed by `npm test` | Passed |
| API-02 | Invalid chat token | POST with an invalid bearer token | HTTP 401 | HTTP 401; passed by `npm test` using mocked Supabase auth | Passed |
| API-03 | FAQ with no Gemini key | Authenticated FAQ question, `CHAT_API_KEY` blank | HTTP 200 with FAQ reply | HTTP 200, `fallback: true`, FAQ reply returned; passed by `npm test` | Passed |
| API-04 | Payment refusal | Ask if a donor can be paid with no key configured | Polite refusal directing to hospital process | HTTP 200 with refusal and hospital-process guidance; passed by `npm test` | Passed |
| API-05 | Direct-contact refusal | Ask how to contact a donor directly with no key configured | Polite refusal directing to hospital process | HTTP 200 with refusal and hospital-process guidance; passed by `npm test` | Passed |
| DB-01 | Schema/grants/RLS | Run `00_schema_assertions.sql` after migrations 005–010 | Every required table has RLS; identity and direct-write grants remain restricted | Not run; no database connection available | Not run |
| DB-02 | Cross-role identity | Run patient/donor blocks in `01_privacy_rls_negative_checks.sql` | Neither role can read the other's identity; donors cannot read patient requests | Not run; deployment UUIDs required | Not run |
| DB-03 | Hospital isolation | Run non-involved-hospital checks with report/audit fixtures | Other hospital's reports and events are not visible | Not run; deployment fixtures required | Not run |
| DB-04 | Chat restriction | Attempt client insert of patient-to-donor thread | Insert denied or constraint rejects it | Not run; Supabase required | Not run |
| DB-05 | Consent/cooldown | Run first two blocks in `02_workflow_negative_checks.sql` | Unconsented and recent-donation donors cannot book | Not run; prepared test profiles required | Not run |
| DB-06 | Wrong hospital | Run wrong-hospital outcome block | Outcome RPC rejects the unrelated hospital | Not run; prepared appointment required | Not run |
| DB-07 | Suspension | Run suspended patient/donor scenarios | Request, volunteer, and chat actions are rejected | Not run; prepared fixtures required | Not run |
| DB-08 | Cancellation/timeout | Run cancellation and timeout blocks | Cancellation releases a place; expired review is flagged | Not run; database fixtures/scheduler required | Not run |
| DB-09 | Concurrent capacity | Execute SQL sessions 03 and 04 concurrently | Exactly one donor books the last place | Not run; two persistent DB sessions required | Not run |
