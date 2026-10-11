async function hospitalScreen(main) {
  main.innerHTML = UI.loading(3);
  let rows, threads, prechecks, appointments, reports, audit;
  try {
    [rows, threads, prechecks, appointments, reports, audit] = await Promise.all([
      API.requests.list(), API.messages.getThreads(), API.prechecks.list(),
      API.appointments.forHospital(), API.reports.list(), API.audit.list()
    ]);
  } catch (e) {
    main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
    return;
  }

  const incoming = rows.filter(r => r.status === 'pending_hospital')
    .sort((a, b) => {
      const urgency = (b.urgency === 'emergency' ? 1 : 0) - (a.urgency === 'emergency' ? 1 : 0);
      return urgency || new Date(b.created_at) - new Date(a.created_at);
    });
  const openCalls = rows.filter(r => r.status === 'pending')
    .sort((a, b) => {
      const urgency = (b.urgency === 'emergency' ? 1 : 0) - (a.urgency === 'emergency' ? 1 : 0);
      return urgency || new Date(b.created_at) - new Date(a.created_at);
    });
  let windows;
  try {
    windows = await Promise.all(openCalls.map(async request =>
      [request.id, await API.appointments.getWindow(request.id)]));
  } catch (e) {
    main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
    return;
  }
  const windowByRequest = new Map(windows);
  const now = new Date();
  const todayAppointments = appointments.filter(row =>
    new Date(row.slot_start).toDateString() === now.toDateString());
  const upcomingAppointments = appointments.filter(row =>
    new Date(row.slot_start).toDateString() !== now.toDateString());
  const establishedThreads = threads.filter(thread => thread.thread_type === 'donor_hospital' ||
    !incoming.some(request => request.id === thread.request_id));
  main.innerHTML = `
    <section class="section">
      <h1>Incoming requests</h1>
      <p class="lede">${UI.esc(Auth.profile.full_name || 'Your hospital')} · review requests before calling for voluntary donors.</p>
    </section>
    ${incoming.length
      ? `<div class="stack">${incoming.map(hospitalRequestCard).join('')}</div>`
      : UI.empty('No incoming requests', 'New patient requests assigned to your hospital will appear here.')}
    ${openCalls.length ? `
      <section class="section">
        <p class="eyebrow">Calls for voluntary donors</p>
        <div class="stack">${openCalls.map(request =>
          hospitalCallCard(request, windowByRequest.get(request.id))).join('')}</div>
      </section>` : ''}
    ${todayAppointments.length || upcomingAppointments.length ? `
      <section class="section">
        <p class="eyebrow">Today's appointments</p>
        ${todayAppointments.length
          ? `<div class="stack">${todayAppointments.map(hospitalAppointmentCard).join('')}</div>`
          : UI.empty('No appointments today', 'Scheduled volunteer visits for today will appear here.')}
      </section>
      <section class="section">
        <p class="eyebrow">Upcoming appointments</p>
        ${upcomingAppointments.length
          ? `<div class="stack">${upcomingAppointments.map(hospitalAppointmentCard).join('')}</div>`
          : UI.empty('No upcoming appointments', 'Future scheduled volunteer visits will appear here.')}
      </section>` : ''}
    ${establishedThreads.length ? `
      <section class="section">
        <p class="eyebrow">Request conversations</p>
        <div class="stack">${establishedThreads.map(thread => hospitalThreadCard(thread, prechecks)).join('')}</div>
      </section>` : ''}
    ${reports.length ? `
      <section class="section">
        <p class="eyebrow">Reports for your hospital</p>
        <div class="stack">${reports.map(hospitalReportCard).join('')}</div>
      </section>` : ''}
    ${audit.length ? `
      <section class="section">
        <p class="eyebrow">Recent request audit</p>
        <div class="stack">${audit.map(hospitalAuditCard).join('')}</div>
      </section>` : ''}`;

  main.querySelectorAll('[data-hospital-decision]').forEach(button => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-request-card]');
      const noteField = card.querySelector('[data-hospital-note]');
      const note = noteField.value.trim();
      const approved = button.dataset.hospitalDecision === 'approve';
      const done = UI.busy(button, approved ? 'Approving…' : 'Declining…');
      try {
        const updated = await API.requests.decideAtHospital(
          button.dataset.requestId, Auth.profile.hospital_id, approved, note);
        if (!updated) throw new Error('This request has already been reviewed.');
        UI.toast(approved ? 'Request approved. The hospital can now call for voluntary donors.' : 'Request declined; the patient has been notified.');
        Router.refresh();
      } catch (e) {
        done();
        const message = card.querySelector('[data-decision-message]');
        message.innerHTML = UI.errorBox(UI.humanError(e));
      }
    });
  });
  main.querySelectorAll('[data-message-patient]').forEach(button => {
    button.addEventListener('click', () => {
      MessagesWidget.openForRequest(button.dataset.requestId, 'patient_hospital', button.dataset.participantId);
    });
  });
  main.querySelectorAll('[data-message-thread]').forEach(button => {
    button.addEventListener('click', () => {
      MessagesWidget.openForRequest(button.dataset.requestId, button.dataset.threadType, button.dataset.participantId);
    });
  });
  main.querySelectorAll('[data-save-window]').forEach(button => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-call-card]');
      const start = card.querySelector('[data-window-start]');
      const end = card.querySelector('[data-window-end]');
      const length = card.querySelector('[data-slot-minutes]');
      if (!start.value || !end.value) {
        UI.toast('Choose both the appointment window start and end.', 'bad');
        return;
      }
      const done = UI.busy(button, 'Saving…');
      try {
        await API.appointments.setWindow(button.dataset.saveWindow,
          new Date(start.value).toISOString(), new Date(end.value).toISOString(), Number(length.value));
        UI.toast('Appointment times saved.');
        Router.refresh();
      } catch (e) {
        done();
        card.querySelector('[data-window-error]').innerHTML = UI.errorBox(UI.humanError(e));
      }
    });
  });
  main.querySelectorAll('[data-record-outcome]').forEach(button => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-appointment-card]');
      const note = card.querySelector('[data-outcome-note]').value.trim();
      const done = UI.busy(button, 'Saving…');
      try {
        await API.appointments.recordOutcome(button.dataset.appointmentId,
          button.dataset.recordOutcome, note);
        UI.toast(button.dataset.recordOutcome === 'donated'
          ? 'Donation recorded. Thank you for supporting voluntary donation.'
          : 'Appointment outcome recorded.');
        Router.refresh();
      } catch (e) {
        done();
        card.querySelector('[data-outcome-error]').innerHTML = UI.errorBox(UI.humanError(e));
      }
    });
  });
  main.querySelectorAll('[data-suspend-form]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const reason = form.querySelector('[data-suspend-reason]');
      const button = form.querySelector('button[type="submit"]');
      if (!reason.value.trim()) {
        UI.fieldError(reason, 'Enter a reason for this action.');
        return;
      }
      if (!window.confirm(`Suspend this ${form.dataset.suspendRole} account? It will no longer be able to request, volunteer or message.`)) return;
      const done = UI.busy(button, 'Suspending…');
      try {
        await API.profiles.suspend(form.dataset.profileId, reason.value);
        UI.toast('Account suspended.');
        Router.refresh();
      } catch (e) {
        done();
        form.querySelector('[data-suspend-error]').innerHTML = UI.errorBox(UI.humanError(e));
      }
    });
  });
}

function hospitalCallCard(request, window) {
  const start = window ? localDateTimeValue(window.window_start) : '';
  const end = window ? localDateTimeValue(window.window_end) : '';
  return `<article class="card section" data-call-card>
    <div class="row-between">
      <div class="row__title"><span class="avatar avatar--blood">${UI.esc(request.blood_type)}</span>
        ${request.units} unit${request.units === 1 ? '' : 's'} · ${UI.esc(request.blood_type)}</div>
      ${request.urgency === 'emergency' ? '<span class="tag tag--red">URGENT</span>' : urgencyTag(request.urgency)}
    </div>
    <p class="small muted">${request.volunteer_count || 0} of ${request.units} volunteer appointments confirmed</p>
    <div class="field">
      <label class="label">Appointment window starts</label>
      <input class="input" type="datetime-local" data-window-start value="${start}">
    </div>
    <div class="field">
      <label class="label">Appointment window ends</label>
      <input class="input" type="datetime-local" data-window-end value="${end}">
    </div>
    <div class="field">
      <label class="label">Appointment length</label>
      <select class="select" data-slot-minutes>
        <option value="30"${!window || window.slot_minutes === 30 ? ' selected' : ''}>30 minutes</option>
        <option value="60"${window && window.slot_minutes === 60 ? ' selected' : ''}>60 minutes</option>
      </select>
    </div>
    <div data-window-error aria-live="polite"></div>
    <button class="btn btn--soft btn--block" data-save-window="${UI.esc(request.id)}">Save appointment times</button>
  </article>`;
}

function hospitalAppointmentCard(appointment) {
  const request = appointment.request || {};
  return `<article class="card section" data-appointment-card>
    <div class="row-between">
      <div class="row__title"><span class="avatar avatar--blood">${UI.esc(request.blood_type || '')}</span>
        ${UI.esc(request.blood_type || '')} · ${UI.esc(request.urgency || '')}</div>
      ${request.urgency === 'emergency' ? '<span class="tag tag--red">URGENT</span>' : ''}
    </div>
    <p class="small muted">${UI.esc(new Date(appointment.slot_start).toLocaleString())} · Volunteer reference ${UI.esc(appointment.donor_id.slice(0, 8))}</p>
    <label class="label">Private hospital note</label>
    <textarea class="textarea" rows="2" maxlength="500" data-outcome-note placeholder="Optional note for hospital records"></textarea>
    <div class="btn-row">
      <button class="btn btn--primary btn--sm" data-record-outcome="donated" data-appointment-id="${UI.esc(appointment.id)}">Donated</button>
      <button class="btn btn--soft btn--sm" data-record-outcome="deferred" data-appointment-id="${UI.esc(appointment.id)}">Deferred</button>
      <button class="btn btn--danger-ghost btn--sm" data-record-outcome="no_show" data-appointment-id="${UI.esc(appointment.id)}">No-show</button>
    </div>
    <div data-outcome-error aria-live="polite"></div>
  </article>`;
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function hospitalThreadCard(thread, prechecks) {
  const request = thread.request || {};
  const kind = thread.thread_type === 'patient_hospital' ? 'patient' : 'donor';
  const precheck = kind === 'donor'
    ? prechecks.find(row => row.request_id === thread.request_id && row.donor_id === thread.participant_id)
    : null;
  const precheckSummary = precheck ? `
    <div class="precheck-summary">
      <p class="small muted">Volunteer pre-check · self-reported flags only · not medical clearance</p>
      <p class="small muted">Age 18+: ${precheck.age_18_or_older ? 'Yes' : 'No'} · Weight 50 kg+: ${precheck.weight_50kg_or_more ? 'Yes' : 'No'}</p>
      <p class="small muted">Feeling well: ${precheck.feeling_well ? 'Yes' : 'No'} · Recent illness: ${precheck.recent_illness ? 'Yes' : 'No'} · Recent tattoo: ${precheck.recent_tattoo ? 'Yes' : 'No'} · Recent travel: ${precheck.recent_travel ? 'Yes' : 'No'} · Medication: ${precheck.medication ? 'Yes' : 'No'} · Donation within 56 days: ${precheck.recent_donation ? 'Yes' : 'No'}</p>
      <p class="small muted">Final eligibility is decided by the hospital's medical screening.</p>
    </div>` : '';
  return `<article class="card card--flat">
    <div class="row-between">
      <div>
        <p class="row__title" style="margin:0">Message ${kind}</p>
        <p class="row__sub">${UI.esc(request.blood_type || '')} · ${UI.esc(request.urgency || '')} · ${UI.esc(String(request.status || '').replace(/_/g, ' '))}</p>
      </div>
      ${thread.unread_count ? '<span class="tag tag--red">Unread</span>' : ''}
    </div>
    <button class="btn btn--soft btn--block btn--sm" style="margin-top:8px"
      data-message-thread data-request-id="${UI.esc(thread.request_id)}"
      data-thread-type="${UI.esc(thread.thread_type)}" data-participant-id="${UI.esc(thread.participant_id)}">
      ${UI.icon('message')} Message ${kind}
    </button>
    ${suspensionControl(thread.participant_id, kind)}
    ${precheckSummary}
  </article>`;
}

function suspensionControl(profileId, role) {
  return `<details class="section">
    <summary class="link-btn">Suspend ${role} account</summary>
    <form class="stack" data-suspend-form data-profile-id="${UI.esc(profileId)}"
      data-suspend-role="${role}" style="margin-top:8px">
      <label class="label">Reason
        <textarea class="textarea" rows="2" maxlength="500" required data-suspend-reason
          placeholder="Explain why this account needs review"></textarea>
      </label>
      <div data-suspend-error aria-live="polite"></div>
      <button class="btn btn--danger-ghost btn--sm" type="submit">Suspend account</button>
    </form>
  </details>`;
}

function hospitalReportCard(report) {
  const reasonLabels = {
    payment_requested_offered: 'Payment requested or offered',
    suspicious_request: 'Suspicious request',
    harassment: 'Harassment',
    other: 'Other'
  };
  return `<article class="card card--flat">
    <div class="row-between">
      <p class="row__title">${UI.esc(reasonLabels[report.reason] || 'Report')}</p>
      <time class="small muted">${UI.esc(UI.timeAgo(report.created_at))}</time>
    </div>
    <p class="row__sub">${UI.esc(report.reporter_role)} · Request ${UI.esc(report.request_id)}</p>
    ${report.details ? `<p class="small">${UI.esc(report.details)}</p>` : ''}
  </article>`;
}

function hospitalAuditCard(entry) {
  const from = entry.from_status ? String(entry.from_status).replace(/_/g, ' ') : '—';
  const to = entry.to_status ? String(entry.to_status).replace(/_/g, ' ') : '—';
  return `<article class="card card--flat">
    <div class="row-between">
      <p class="row__title">${UI.esc(String(entry.event || '').replace(/[._]/g, ' '))}</p>
      <time class="small muted">${UI.esc(UI.timeAgo(entry.created_at))}</time>
    </div>
    <p class="row__sub">Request ${UI.esc(entry.request_id)} · ${UI.esc(from)} → ${UI.esc(to)}</p>
    ${entry.note ? `<p class="small">${UI.esc(entry.note)}</p>` : ''}
  </article>`;
}

function hospitalRequestCard(r) {
  const urgent = r.urgency === 'emergency';
  return `<article class="card section" data-request-card="${UI.esc(r.id)}">
    <div class="row-between">
      <div class="row__title">
        <span class="avatar avatar--blood">${UI.esc(r.blood_type)}</span>
        ${r.units} unit${r.units === 1 ? '' : 's'} of ${UI.esc(r.blood_type)}
      </div>
      ${urgent ? '<span class="tag tag--red">URGENT · Emergency</span>' : urgencyTag(r.urgency)}
    </div>
    <p class="small muted">${UI.esc(r.patient ? r.patient.full_name : 'Patient')} · ${UI.timeAgo(r.created_at)}</p>
    ${r.patient && r.patient.phone ? `<p class="small">${UI.icon('phone')} ${UI.esc(r.patient.phone)}</p>` : ''}
    <label class="label" for="hospital-note-${UI.esc(r.id)}">Optional note to patient</label>
    <textarea class="textarea" id="hospital-note-${UI.esc(r.id)}" rows="2" maxlength="500"
      placeholder="e.g. Please report to Lab 2" data-hospital-note></textarea>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn--primary" data-hospital-decision="approve" data-request-id="${UI.esc(r.id)}">${UI.icon('check')} Approve</button>
      <button class="btn btn--danger-ghost" data-hospital-decision="decline" data-request-id="${UI.esc(r.id)}">Decline</button>
    </div>
    ${suspensionControl(r.patient_id, 'patient')}
    <button class="btn btn--soft btn--block btn--sm" style="margin-top:8px"
      data-message-patient data-request-id="${UI.esc(r.id)}" data-participant-id="${UI.esc(r.patient_id)}">
      ${UI.icon('message')} Message patient
    </button>
    <div data-decision-message aria-live="polite"></div>
  </article>`;
}
