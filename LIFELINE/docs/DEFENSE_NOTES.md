# Project defense notes

## Scope and limitations

Lifeline coordinates people and hospital workflows only. It does **not** store
blood, test blood, collect blood, provide clinical care, decide medical
eligibility, or handle payments. Donation is voluntary and unpaid. The
hospital performs all medical screening and collection and makes the final
clinical decisions.

The design is informed by the voluntary-donation principle in Philippine
RA 7719 and the privacy principles of the Data Privacy Act of 2012 (RA 10173).
These references are project context, not a compliance determination. Verify
the exact legal obligations, lawful basis, notices, retention, data-subject
rights, and operational requirements with an appropriate authority. Do not
describe Lifeline as medically or legally compliant.

Other limitations to acknowledge:

- Database privacy depends on applying all migrations to the target Supabase
  project and testing with role-specific accounts. Local mock mode does not
  exercise RLS.
- SQL negative and concurrency checks require deployment-specific fixtures;
  they were not run in this workspace.
- The timeout RPC needs `pg_cron` or a separately managed service-role
  scheduler. The project does not itself guarantee that a scheduler is
  configured.
- LIA's rate and daily AI counters are process-local, reset at restart, and
  are not shared between server instances. FAQ fallback does not require
  Gemini. AI output can be inaccurate; users should consult a hospital or
  healthcare professional for medical questions.
- Automatic retention/deletion schedules for messages, reports, audit data,
  and backups are not implemented.
- Demo data is in-memory and is not evidence of persistence, security, or
  clinical readiness.

## Likely panel questions

1. **What problem does Lifeline solve?**  
   It coordinates patient requests, hospital review, volunteer responses,
   appointments, and status updates in one hospital-led workflow.

2. **Can a patient browse donors or call one directly?**  
   No. Patients see their hospital request and aggregate progress. Patient and
   donor identities/contact details are not exposed to each other, and chat
   is limited to each person and the responsible hospital.

3. **How does the system prevent blood from being treated as a commodity?**  
   The interface and consent flow state that donation is voluntary and unpaid.
   LIA and report categories discourage payment, and the app contains no
   payment or blood-purchase workflow.

4. **Who decides whether a volunteer can donate?**  
   Hospital medical staff decide after on-site screening. Lifeline's
   self-check is only a non-clinical pre-check and is not medical clearance.

5. **What happens after a patient submits a request?**  
   The selected hospital reviews it first. Only after approval does the
   hospital call for voluntary donors; eligible volunteers can then book a
   hospital slot.

6. **What does the patient learn about donors?**  
   The patient sees progress and an aggregate volunteer count, not donor
   identity, contact information, pre-check answers, or appointment rows.

7. **How is database privacy enforced?**  
   Supabase RLS, column/table grants, restricted views, and guarded database
   functions/triggers are intended to enforce role-scoped access. The SQL
   checks must still be run against the deployed database.

8. **How are appointments and duplicate bookings handled?**  
   A guarded booking function locks the request row, checks remaining capacity
   and eligibility preconditions, then inserts the appointment. A two-session
   SQL race test is supplied but has not been run here.

9. **What does LIA do, and what are its limitations?**  
   It answers coordination and general-information questions using Gemini
   when configured, and uses a local FAQ if the key is missing or a provider
   call fails. It is not a doctor; AI output may be wrong and is not a medical
   decision.

10. **Does the project establish compliance with Philippine law?**  
    No. RA 7719 and RA 10173 guide the project's ethical and privacy design,
    but the code is not a legal opinion or compliance assessment. Exact
    obligations must be verified before real-world deployment.
