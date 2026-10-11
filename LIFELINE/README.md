# Lifeline

Lifeline is a student-project web app for coordinating hospital-led calls for
voluntary, unpaid blood donors. A patient sends a request to a selected
hospital; the hospital reviews it and, if appropriate, coordinates a call;
volunteers can book an appointment at that hospital; and the hospital records
the visit outcome. Patients see progress and aggregate counts, not donor
identities.

Lifeline is a coordination tool only. It does not sell, store, test, collect,
or transport blood; provide medical care; or decide whether anyone is eligible
to donate. The hospital performs all medical screening and collection and
makes the final medical decisions. Donation is voluntary and unpaid.

## Requirements

- Node.js with npm
- A Supabase project for the database-backed workflow
- The Supabase JavaScript client is loaded from the CDN in `frontend/index.html`
- A Google Gemini API key is optional; LIA uses its offline FAQ when no key is
  configured or the AI service cannot answer

## Local setup

1. Install the backend dependencies:

   ```powershell
   npm --prefix backend install
   ```

2. Copy `backend/.env.example` to `backend/.env`. Set the Supabase URL and
   publishable/anon key placeholders to the values for your project. Add a
   Gemini key only if you want AI-backed LIA responses. Do not put a service
   role key or Gemini key in the frontend.

3. Set the Supabase project URL and **publishable/anon** client key in
   `frontend/js/config.js`. That client key is designed to be public; database
   grants and RLS must protect data. Never use a Supabase service role key in
   this file.

4. Ensure the project's baseline schema (the schema that creates the original
   `profiles` and `requests` tables and signup functions) exists. Apply these
   migrations in numeric order:

   1. `backend/supabase/migrations/005_hospital_workflow.sql`
   2. `backend/supabase/migrations/006_messages.sql`
   3. `backend/supabase/migrations/007_privacy_redesign.sql`
   4. `backend/supabase/migrations/008_consent_precheck_ethics.sql`
   5. `backend/supabase/migrations/009_hospital_appointments.sql`
   6. `backend/supabase/migrations/010_abuse_privacy_audit.sql`

   The baseline migrations before 005 are not included in this workspace.
   Apply and validate the baseline before these files. Use a disposable
   Supabase project for development and testing.

5. Start the server:

   ```powershell
   npm run dev
   ```

   Open <http://localhost:3001>. `GET /api/health` reports backend status.

## Demo accounts

The sign-in screen offers local mock accounts for a patient, donor, and
hospital. In mock mode, use the `Demo123!` password:

| Role | Email |
| --- | --- |
| Patient | `patient@demo.com` |
| Patient conversation example | `mary@demo.com` |
| Volunteer donor | `donor@demo.com` |
| Hospital | `hospital@demo.com` |

Mock accounts use in-memory demo data and are not Supabase Auth users. Their
changes are reset when the browser's local demo session/data is cleared or the
page is reloaded. To test real RLS, use separate Supabase Auth test accounts
and provision a hospital profile by assigning its `hospital_id` to an approved
hospital row. Hospital directory rows are developer-managed in
`public.hospitals`; only approved and active entries are selectable.

## Running the tests

Install backend dependencies first, then run:

```powershell
npm test
```

This runs the backend `node:test` suite, including `/api/chat` authentication
and FAQ fallback checks. It does not require Gemini credentials. Supabase
schema/RLS tests are separate SQL scripts under `backend/supabase/tests`.
Read that directory's README, use deployment-specific disposable fixtures,
and run the scripts against the migrated Supabase project. The two-session
overbooking test requires concurrent database sessions.

## Environment variables

`backend/.env.example` contains placeholders/defaults only. The server loads
`backend/.env` using an explicit path. Relevant settings:

| Variable | Purpose |
| --- | --- |
| `PORT` | Local Express port (default 3001) |
| `NODE_ENV` | Runtime mode |
| `SUPABASE_URL` | Supabase project URL used for server-side token verification |
| `SUPABASE_ANON_KEY` | Supabase publishable/anon key used by the backend |
| `CHAT_API_KEY` | Optional Gemini key; leave blank for the FAQ fallback |
| `CHAT_MODEL` | Gemini model name supported by the `v1beta` `generateContent` endpoint |

Never commit `.env` files, service role credentials, or Gemini keys. LIA's
request and daily AI limits are held in process memory; they reset on restart
and are not shared between multiple server instances.

## Folder structure

```text
frontend/                       Static HTML, CSS, vanilla JavaScript and assets
  js/api.js                     Supabase adapter and in-memory demo adapter
  js/auth.js                    Authentication/profile state
  js/router.js                  Role-aware navigation and realtime refresh
  js/screens/                   Patient, donor, hospital and profile screens
backend/
  server.js                     Express static server and authenticated /api/chat
  tests/                        Built-in Node test runner tests
  supabase/migrations/          Ordered Supabase SQL migrations
  supabase/tests/               SQL schema/RLS/workflow checks
docs/                           Privacy, process, change and defense documents
```

## Process and privacy

The hospital controls the request-to-volunteer workflow. Donors receive
anonymous calls exposing only call and hospital information. Patients see
hospital progress and aggregate volunteer counts. Messaging is between a
patient and the responsible hospital, or a booked volunteer and that hospital;
there is no patient-to-donor conversation. Database RLS and guarded RPCs are
intended to enforce these boundaries, but they must be verified against the
deployed Supabase project before use.

See [docs/PROCESS_FLOW.md](docs/PROCESS_FLOW.md) for the process diagram,
[docs/PRIVACY.md](docs/PRIVACY.md) for data visibility/retention, and
[docs/DEFENSE_NOTES.md](docs/DEFENSE_NOTES.md) for limitations and presentation
notes. Philippine RA 7719 and the Data Privacy Act of 2012 (RA 10173) inform
the project's ethics and privacy design; verify the exact legal obligations
with an appropriate authority. This project does not claim medical or legal
compliance.

## Known limitations

- Database/RLS behavior depends on the migrations being applied successfully;
  the SQL scripts require deployment-specific accounts and fixtures.
- The timeout worker needs `pg_cron` permission or an external service-role
  scheduler to call `lifeline_process_expired_requests()` regularly.
- LIA rate and daily AI counters are in-memory and not distributed.
- Demo data is not persistent and does not prove database privacy controls.
- No production retention/deletion schedule, clinical workflow, blood
  collection, laboratory testing, or medical eligibility decision is provided.
- External Gemini and live Supabase behavior depend on provider availability,
  project configuration, and credentials.
