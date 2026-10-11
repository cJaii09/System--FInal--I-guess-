# Lifeline privacy overview

This document describes the data currently used by Lifeline and the access
boundaries implemented in the application and Supabase migrations. It is an
engineering summary, not legal advice. The Philippine Data Privacy Act of 2012
(RA 10173) is a guiding law for this project; the project owner should verify
the exact legal obligations, lawful basis, notices, retention periods, and
data-subject processes that apply before deployment.

## Data collected and purpose

| Data | Why Lifeline uses it |
| --- | --- |
| Supabase Auth email and authentication records | Sign-in, account recovery, and account administration. Passwords are handled by Supabase Auth and are not stored in Lifeline profile fields. |
| Profile name, phone, address, role, hospital link, and donor blood type/status | Account display, hospital request review, volunteer-call coordination, and role-scoped access. |
| Donor consent timestamp/version and last confirmed donation date/count | Record consent to voluntary, unpaid donation and enforce the 56-day volunteer cooldown. |
| Patient request blood type, units, urgency, chosen hospital, status, hospital note, and timestamps | Hospital review and aggregate progress updates. |
| Donor pre-check answers | Store self-reported screening flags for the donor and the hospital involved in an appointment. They are not medical clearance. |
| Appointment donor/hospital/request IDs, slot, status, notes, and cancellation reason | Schedule volunteers and let the hospital record on-site screening outcomes. |
| Chat sender/thread IDs, message text, timestamps, and read state | Patient-to-hospital and donor-to-hospital coordination. No patient-to-donor thread is allowed. |
| Abuse report category, optional details, reporter association, linked request/hospital, and timestamp | Let the related hospital review reports of payment requests/offers, suspicious requests, harassment, or other concerns. |
| Request notification and audit events | Deliver role/recipient-scoped updates and preserve hospital-only request/appointment history. `request_events` is the notification stream; `request_audit_events` is the separate audit log. |

Do not put passwords, ID numbers, or unnecessary medical details in requests,
reports, or messages. Lifeline coordinates voluntary, unpaid donation; it does
not sell blood, store or test blood, or decide medical eligibility.

## Who can see the data

- A patient can read their own request and hospital progress, including an
  aggregate volunteer count. Patients do not receive donor identity,
  appointment records, donor contact information, pre-check answers, or audit
  events.
- A donor sees eligible anonymous hospital calls and their own appointments,
  pre-check flags, and hospital conversations. Donors do not see patient
  identity, contact details, address, or coordinates.
- The hospital assigned to a request can review that request and the patient
  contact details needed for care coordination. It can see appointments and
  the related volunteer pre-check flags. The assigned hospital alone can read
  reports and audit events for its requests.
- Chat access is limited to the request's patient and hospital, or to a
  volunteer with an appointment and that appointment's hospital. Realtime
  message and request notifications are scoped by database policies.
- A suspended account cannot create requests, volunteer, or use chat. A
  suspension is account-wide even though only a hospital connected to that
  account's request or appointment may apply it.
- Supabase project administrators/service-role processes can access data
  according to their elevated database privileges. Restrict and audit those
  credentials separately; never put a service-role key in the frontend.

These are intended database policies, not just UI visibility rules. Apply and
test all migrations in `backend/supabase/migrations` before relying on these
boundaries in a deployed environment.

## Retention and deletion

Lifeline currently does not implement automatic expiry for profiles, requests,
appointments, chat messages, reports, audit records, or notification records.
Records linked to a request may be deleted by database cascade when that
request is deleted; profiles and Supabase Auth records have their own deletion
behavior. Supabase backups and hosting logs may retain data under provider
policies even after application-level deletion. Define and implement an
approved retention/deletion schedule, including backup and log handling, before
production use. Do not treat database cascade behavior as a complete retention
policy.
