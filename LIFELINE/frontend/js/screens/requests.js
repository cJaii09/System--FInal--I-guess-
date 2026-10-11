/* Requests: list, create, detail and donor actions. Access is enforced by the
   Supabase policies installed in backend/supabase/migrations. */

let requestsTab = 'open';       // donor side: 'open' | 'accepted'
let newReqUrgency = 'normal';   // requests.urgency enum
let newReqPreset = null;        // urgency preselected by the emergency screen

function urgencyTag(u) {
  if (u === 'emergency') return '<span class="tag tag--red">Emergency</span>';
  if (u === 'urgent') return '<span class="tag tag--amber">Urgent</span>';
  return '<span class="tag">Normal</span>';
}

function statusTag(r) {
  if (r.appointment && r.appointment.status === 'scheduled') return '<span class="tag"><span class="dot dot--green"></span>Appointment scheduled</span>';
  if (r.appointment && r.appointment.status === 'donated') return '<span class="tag">Donation recorded</span>';
  if (r.status === 'accepted') return '<span class="tag"><span class="dot dot--green"></span>Appointment scheduled</span>';
  if (r.status === 'completed') return '<span class="tag">Completed</span>';
  if (r.status === 'hospital_declined') return '<span class="tag tag--red">Hospital declined</span>';
  if (r.status === 'declined' || r.status === 'cancelled') return '<span class="tag">Closed</span>';
  if (r.status === 'pending_hospital') return '<span class="tag"><span class="dot dot--amber"></span>Hospital review</span>';
  return '<span class="tag"><span class="dot dot--amber"></span>Waiting</span>';
}

function hospitalName(r) {
  return (r.hospital_info && r.hospital_info.name) || r.hospital_name || r.hospital || 'Hospital not set';
}

function hospitalAddress(r) {
  return (r.hospital_info && r.hospital_info.address) || r.hospital_address || '';
}

function donorEligibleOn(lastDonatedAt) {
  if (!lastDonatedAt) return null;
  const last = new Date(lastDonatedAt);
  if (Number.isNaN(last.getTime())) return null;
  const eligible = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() + 56);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return todayUtc < eligible ? new Date(eligible) : null;
}

function donorCooldownMessage() {
  const eligibleOn = donorEligibleOn(Auth.profile && Auth.profile.last_donated_at);
  return eligibleOn ? `You can volunteer again on ${eligibleOn.toLocaleDateString()}.` : '';
}

function requestListRow(r) {
  const sub = Auth.isDonor
    ? `${UI.esc(hospitalName(r))}${hospitalAddress(r) ? ` · ${UI.esc(hospitalAddress(r))}` : ''} · ${UI.timeAgo(r.created_at)}`
    : `${UI.esc(hospitalName(r))} · ${UI.timeAgo(r.created_at)}`;
  return `<li><button class="row" data-go="#/requests/${r.id}">
    <span class="avatar avatar--blood">${UI.esc(r.blood_type)}</span>
    <span class="row__main">
      <span class="row__title">${r.units} unit${r.units === 1 ? '' : 's'} ${urgencyTag(r.urgency)}</span>
      <span class="row__sub">${sub}</span>
    </span>
    <span class="row__side">${statusTag(r)}${UI.icon('chevron')}</span>
  </button></li>`;
}

/* --------------------------------------------------------- list screen */
async function requestsScreen(main) {
  if (Auth.isHospital) return hospitalScreen(main);
  main.innerHTML = UI.loading(4);
  const me = Auth.profile;
  let all, appointments = [];
  try {
    [all, appointments] = await Promise.all([
      API.requests.list(),
      Auth.isDonor ? API.appointments.mine() : Promise.resolve([])
    ]);
  } catch (e) {
    main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
    return;
  }

  let rows, empty;
  if (Auth.isDonor) {
    const open = all.filter(r => r.status === 'pending');
    const accepted = appointments.map(appointment => ({
      ...(appointment.request || {}),
      id: appointment.request_id,
      status: appointment.request && appointment.request.status === 'completed'
        ? 'completed' : appointment.status === 'cancelled' ? 'cancelled' : 'accepted',
      appointment
    }));
    rows = requestsTab === 'accepted' ? accepted : open;
    empty = requestsTab === 'accepted'
      ? UI.empty('No volunteer responses yet', 'Hospital calls you volunteer for appear here so you can coordinate with the hospital.')
      : UI.empty('No hospital calls', `No calls for ${me.blood_type || 'your blood type'} are waiting right now.`);
  } else {
    rows = all;
    empty = UI.empty('No requests yet', 'When you request blood it will show up here.',
      '<button class="btn btn--primary" data-go="#/requests/new">Request blood</button>');
  }

  main.innerHTML = `
    <div class="row-between section">
      <h1>${Auth.isDonor ? 'Hospital calls' : 'Your requests'}</h1>
      ${Auth.isDonor ? '' : `<button class="btn btn--primary btn--sm" data-go="#/requests/new">${UI.icon('plus')} New</button>`}
    </div>

    ${Auth.isDonor ? `
    <div class="chips section" role="group" aria-label="Filter requests">
      <button class="chip" data-rtab="open" aria-pressed="${requestsTab === 'open'}">Open calls</button>
      <button class="chip" data-rtab="accepted" aria-pressed="${requestsTab === 'accepted'}">My responses</button>
    </div>` : ''}

    ${rows.length ? `<ul class="list card">${rows.map(requestListRow).join('')}</ul>` : empty}`;

  main.querySelectorAll('[data-rtab]').forEach(btn => {
    btn.addEventListener('click', () => { requestsTab = btn.dataset.rtab; Router.refresh(); });
  });
}

/* ------------------------------------------------------- create screen */
async function newRequestScreen(main) {
  const me = Auth.profile;
  newReqUrgency = newReqPreset || 'normal';
  newReqPreset = null;
  main.innerHTML = UI.loading(2);
  let hospitals;
  try {
    hospitals = await API.hospitals.list();
  } catch (e) {
    main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
    return;
  }

  main.innerHTML = `
    <h1 class="section">Request blood</h1>
    <form id="req-form" class="card section" novalidate>
      <div class="field">
        <label class="label" for="rq-blood">Blood type needed</label>
        <select class="select" id="rq-blood" required>
          <option value="">Choose a blood type</option>
          ${BLOOD_TYPES.map(b => `<option value="${b}"${b === me.blood_type ? ' selected' : ''}>${b}</option>`).join('')}
        </select>
      </div>

      <fieldset class="field" style="border:0;padding:0;margin-left:0;margin-right:0">
        <legend class="label" style="padding:0">How urgent is it?</legend>
        <div class="chips" role="group" aria-label="Urgency level">
          ${URGENCIES.map(u => `<button type="button" class="chip" data-urgency="${u}"
            aria-pressed="${newReqUrgency === u}">${u[0].toUpperCase() + u.slice(1)}</button>`).join('')}
        </div>
        <p class="hint" id="urgency-hint">Normal — within a few days. Urgent — today. Emergency — right now.</p>
      </fieldset>

      <div class="field">
        <label class="label" for="rq-units">Units needed</label>
        <input class="input" id="rq-units" type="number" inputmode="numeric" min="1" step="1" value="1" required>
        <p class="hint">One unit is roughly one bag of blood.</p>
      </div>

      <div class="field">
        <label class="label" for="rq-hospital">Hospital</label>
        <select class="select" id="rq-hospital" required>
          <option value="">Choose an approved hospital</option>
          ${hospitals.map(h => `<option value="${UI.esc(h.id)}">${UI.esc(h.name)}${h.address ? ` — ${UI.esc(h.address)}` : ''}</option>`).join('')}
        </select>
      </div>

      <div class="notice notice--warn" style="margin-bottom:10px">
        ${UI.icon('info')}<span>Donors are voluntary, unpaid volunteers. No payment may be offered. The hospital coordinates every step.</span>
      </div>
      <label class="consent-check">
        <input type="checkbox" id="rq-ethics-ack" required>
        <span>I understand that donors are unpaid volunteers, no payment may be offered, and the hospital coordinates everything.</span>
      </label>
      <div id="rq-ethics-error" aria-live="polite"></div>

      <div id="req-msg" aria-live="polite"></div>
      <button class="btn btn--primary btn--block" id="rq-submit" type="submit">Submit request</button>
    </form>`;

  bindNewRequest(main);
}

function bindNewRequest(main) {
  main.querySelectorAll('[data-urgency]').forEach(btn => {
    btn.addEventListener('click', () => {
      newReqUrgency = btn.dataset.urgency;
      main.querySelectorAll('[data-urgency]').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.urgency === newReqUrgency)));
    });
  });

  const form = document.getElementById('req-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const blood = document.getElementById('rq-blood');
    const units = document.getElementById('rq-units');
    const hospital = document.getElementById('rq-hospital');
    const ethics = document.getElementById('rq-ethics-ack');
    const ethicsError = document.getElementById('rq-ethics-error');
    const msg = document.getElementById('req-msg');
    UI.clearErrors(form);
    msg.innerHTML = '';
    ethicsError.textContent = '';

    let ok = true;
    if (!blood.value) { UI.fieldError(blood, 'Choose the blood type you need.'); ok = false; }
    if (!hospital.value) { UI.fieldError(hospital, 'Choose an approved hospital.'); ok = false; }
    if (!ethics.checked) {
      ethicsError.innerHTML = UI.errorBox('Confirm the voluntary, unpaid donation notice before sending your request.');
      ok = false;
    }
    const n = Number(units.value);
    if (!Number.isInteger(n) || n < 1) { UI.fieldError(units, 'Enter a whole number of units, at least 1.'); ok = false; }
    if (!ok) {
      (form.querySelector('[aria-invalid="true"]') || (!ethics.checked ? ethics : blood)).focus();
      return;
    }

    const submit = document.getElementById('rq-submit');
    const done = UI.busy(submit, 'Sending…');
    try {
      const created = await API.requests.create({
        patient_id: Auth.id,
        blood_type: blood.value,
        urgency: newReqUrgency,
        units: n,
        hospital_id: hospital.value,
        volunteer_ethics_acknowledged: true
      });
      UI.toast('Request sent to the hospital for review.');
      Router.go('#/requests/' + (created ? created.id : ''));
    } catch (e) {
      done();
      msg.innerHTML = UI.errorBox(UI.humanError(e));
    }
  });
}

/* -------------------------------------------------------- detail screen */
async function requestDetailScreen(main, params) {
  main.innerHTML = UI.loading(3);
  const id = params[0];
  let r;
  try {
    r = await API.requests.get(id);
  } catch (e) {
    main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
    return;
  }
  if (!r) {
    main.innerHTML = UI.empty('Request not available',
      'It may have been closed, or it is not visible to your account.',
      '<button class="btn btn--soft" data-go="#/requests">Back to requests</button>');
    return;
  }
  let hospitals = [];
  if (!Auth.isDonor && !Auth.isHospital && r.status === 'hospital_declined') {
    try { hospitals = await API.hospitals.list(); }
    catch (e) {
      main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
      return;
    }
  }
  main.innerHTML = detailHtml(r, hospitals);
  bindDetail(main, r);
}

function detailHtml(r, hospitals) {
  return `
    <section class="card section">
      <div class="row-between">
        <div class="row__title" style="font-size:19px">
          <span class="avatar avatar--blood">${UI.esc(r.blood_type)}</span>
          <span>${r.units} unit${r.units === 1 ? '' : 's'} of ${UI.esc(r.blood_type)}</span>
        </div>
        ${statusTag(r)}
      </div>
      <div class="inline-actions" style="margin-top:10px">
        ${urgencyTag(r.urgency)}
        <span class="small muted">${UI.icon('clock')} ${UI.timeAgo(r.created_at)}</span>
      </div>
      <hr class="divider">
      <div class="row row--static" style="padding:6px 0">
        <span class="row__main">
          <span class="row__title" style="font-size:14.5px">${UI.icon('building')} Hospital</span>
          <span class="row__sub">${UI.esc(hospitalName(r))}${hospitalAddress(r) ? ` · ${UI.esc(hospitalAddress(r))}` : ''}</span>
        </span>
      </div>
      ${r.hospital_note ? `<p class="small muted" style="margin:8px 0 0">${UI.esc(r.hospital_note)}</p>` : ''}
    </section>

    ${!Auth.isDonor && !Auth.isHospital ? patientProgressHtml(r) : ''}
    ${actionHtml(r, hospitals)}
    ${messageShortcut(r)}
    ${Auth.isHospital ? '' : reportFormHtml(r.id)}

    <div id="detail-msg" aria-live="polite"></div>`;
}

function reportFormHtml(requestId, threadId = '') {
  return `<details class="card section">
    <summary class="btn btn--soft btn--block">Report this request</summary>
    <form class="stack" data-report-form data-request-id="${UI.esc(requestId)}"
      data-thread-id="${UI.esc(threadId)}" style="margin-top:10px">
      <label class="label">Reason
        <select class="select" data-report-reason required>
          <option value="">Choose a reason</option>
          <option value="payment_requested_offered">Payment requested or offered</option>
          <option value="suspicious_request">Suspicious request</option>
          <option value="harassment">Harassment</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label class="label">Details (optional)
        <textarea class="textarea" rows="2" maxlength="1000" data-report-details
          placeholder="Do not include passwords, ID numbers or medical details."></textarea>
      </label>
      <div data-report-message aria-live="polite"></div>
      <button class="btn btn--danger-ghost" type="submit">Send report to the hospital</button>
    </form>
  </details>`;
}

function messageShortcut(r) {
  if (!Auth.isDonor && !Auth.isHospital) {
    return `<section class="section">
      <button class="btn btn--soft btn--block" type="button" data-open-message
        data-thread-type="patient_hospital" data-request-id="${UI.esc(r.id)}">
        ${UI.icon('message')} Message hospital
      </button>
    </section>`;
  }
  if (Auth.isDonor && r.appointment &&
      ['scheduled', 'donated', 'deferred', 'no_show'].includes(r.appointment.status)) {
    return `<section class="section">
      <button class="btn btn--soft btn--block" type="button" data-open-message
        data-thread-type="donor_hospital" data-request-id="${UI.esc(r.id)}">
        ${UI.icon('message')} Message hospital
      </button>
    </section>`;
  }
  return '';
}

function patientProgressHtml(r) {
  const verified = !['pending_hospital', 'hospital_declined'].includes(r.status);
  const volunteers = Number(r.volunteer_count || 0);
  const completed = r.status === 'completed';
  const steps = [
    ['Sent to hospital', true],
    ['Verified by hospital', verified],
    ['Volunteers confirmed', volunteers > 0],
    ['Completed', completed]
  ];
  return `<section class="card section">
    <p class="eyebrow">Request progress</p>
    <p class="small muted">${volunteers} of ${r.units} volunteer${r.units === 1 ? '' : 's'} confirmed</p>
    <ol class="progress-list">${steps.map(([label, done]) =>
      `<li class="${done ? 'is-complete' : ''}"><span class="dot ${done ? 'dot--green' : 'dot--muted'}"></span>${label}</li>`
    ).join('')}</ol>
  </section>`;
}

function actionHtml(r, hospitals) {
  const msg = '<div id="action-msg" aria-live="polite"></div>';

  if (!Auth.isDonor && !Auth.isHospital) {
    if (r.status === 'pending_hospital') {
      return `<section class="card section">
        <p class="eyebrow" style="margin-bottom:6px">Waiting for hospital approval</p>
        <p class="small muted" style="margin:0">The hospital will review this request before calling voluntary donors.</p>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn--danger-ghost" data-cancel="${r.id}">Cancel request</button>
        </div>${msg}</section>`;
    }
    if (r.status === 'hospital_declined') {
      return `<section class="card section">
        <p class="eyebrow" style="margin-bottom:6px">Hospital declined</p>
        <p class="small muted" style="margin:0 0 12px">${UI.esc(r.hospital_note || 'The hospital cannot support this request.')}</p>
        <div class="field">
          <label class="label" for="rq-next-hospital">Choose another hospital</label>
          <select class="select" id="rq-next-hospital">
            <option value="">Select a different hospital</option>
            ${(hospitals || []).filter(h => h.id !== r.hospital_id).map(h => `<option value="${UI.esc(h.id)}">${UI.esc(h.name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn--primary btn--block" data-resend="${r.id}">Send to another hospital</button>
        ${msg}</section>`;
    }
    if (r.status === 'pending') {
      return `<section class="card section">
        <p class="eyebrow" style="margin-bottom:6px">Hospital calling for volunteers</p>
        <p class="small muted" style="margin:0 0 12px">The hospital is coordinating voluntary responses. ${Number(r.volunteer_count || 0)} of ${r.units} volunteer${r.units === 1 ? '' : 's'} confirmed so far.</p>
        <button class="btn btn--danger-ghost" data-cancel="${r.id}">Close request</button>
        <hr class="divider">
        <div id="edit-slot">
          <button class="btn btn--soft btn--block btn--sm" data-editopen="${r.id}">Edit request</button>
        </div>
        ${msg}</section>`;
    }
    if (r.status === 'accepted') {
      return `<section class="card section">
        <p class="eyebrow" style="margin-bottom:6px">Volunteer response received</p>
        <p class="small muted" style="margin:0">The hospital is coordinating next steps. Progress will be updated by the hospital.</p>
        ${msg}</section>`;
    }
    if (r.status === 'completed') {
      return `<section class="card section"><p class="small muted" style="margin:0">This request is closed.</p>${msg}</section>`;
    }
    if (r.status === 'cancelled' || r.status === 'declined') {
      return `<section class="card section">
        <p class="small muted" style="margin:0 0 10px">This request is closed.</p>
        ${r.hospital_id ? `<button class="btn btn--soft btn--block" data-reopen="${r.id}">Reopen for hospital review</button>` : ''}
        ${msg}</section>`;
    }
    return `<section class="card section">
      <p class="small muted" style="margin:0">This request is closed.</p>
      ${msg}</section>`;
  }

  /* Donors see anonymous calls from the hospital and respond voluntarily. */
  if (!Auth.isDonor) {
    return `<section class="card section">
      <p class="small muted" style="margin:0">This call is not available to your account.</p>
      ${msg}</section>`;
  }
  if (r.appointment && r.appointment.status === 'scheduled') {
    return `<section class="card section">
      <p class="eyebrow" style="margin-bottom:6px">Your hospital appointment is scheduled</p>
      <div class="stack">
        <p class="small muted" style="margin:0">${UI.esc(new Date(r.appointment.slot_start).toLocaleString())}. The hospital will screen volunteers on site.</p>
        <label class="label" for="cancel-reason-${UI.esc(r.appointment.id)}">Reason for cancelling</label>
        <input class="input" data-cancel-reason maxlength="300" placeholder="Add a short reason">
        <button class="btn btn--danger-ghost btn--block" data-cancel-appointment="${UI.esc(r.appointment.id)}">Cancel appointment</button>
      </div>
      ${msg}</section>`;
  }
  if (r.appointment && r.appointment.status === 'donated') {
    return `<section class="card section"><p class="eyebrow">Thank you for volunteering</p>
      <p class="small muted" style="margin:0">The hospital recorded your donation. Your voluntary contribution is appreciated.</p>${msg}</section>`;
  }
  if (r.appointment && ['deferred', 'no_show', 'cancelled'].includes(r.appointment.status)) {
    const label = r.appointment.status === 'deferred' ? 'The hospital recorded a deferral.'
      : r.appointment.status === 'no_show' ? 'The hospital recorded a missed appointment.'
        : 'This appointment was cancelled.';
    return `<section class="card section"><p class="small muted" style="margin:0">${label}</p>${msg}</section>`;
  }
  if (r.status === 'pending' && !r.appointment) {
    const cooldown = donorCooldownMessage();
    return `<section class="card section">
      <p class="eyebrow" style="margin-bottom:6px">Can you volunteer?</p>
      ${cooldown
      ? `<p class="small muted">${UI.esc(cooldown)}</p>`
      : `<button class="btn btn--coral" data-accept="${UI.esc(r.id)}">${UI.icon('check')} Volunteer at this hospital</button>
         <div data-precheck-slot="${UI.esc(r.id)}"></div>`}
      ${msg}</section>`;
  }
  return `<section class="card section">
    <p class="small muted" style="margin:0">This hospital call is no longer open.</p>
    ${msg}</section>`;
}

function bindDetail(main, r) {
  const msg = () => document.getElementById('detail-msg') || document.getElementById('action-msg');
  const fail = e => { const m = msg(); if (m) m.innerHTML = UI.errorBox(UI.humanError(e)); };

  bindAcceptDecline(main);
  main.querySelectorAll('[data-report-form]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const reason = form.querySelector('[data-report-reason]');
      if (!reason.value) {
        UI.fieldError(reason, 'Choose a reason for this report.');
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      const done = UI.busy(submit, 'Sending…');
      try {
        await API.reports.submit(
          form.dataset.requestId,
          reason.value,
          form.querySelector('[data-report-details]').value,
          form.dataset.threadId || null
        );
        form.reset();
        done();
        UI.toast('Report sent to the hospital for review.');
        form.querySelector('[data-report-message]').textContent = 'Thank you. The hospital can review this report.';
      } catch (error) {
        done();
        form.querySelector('[data-report-message]').innerHTML = UI.errorBox(UI.humanError(error));
      }
    });
  });
  const messageButton = main.querySelector('[data-open-message]');
  if (messageButton) messageButton.addEventListener('click', () => {
    MessagesWidget.openForRequest(r.id, messageButton.dataset.threadType, Auth.id);
  });

  const editSlot = document.getElementById('edit-slot');
  if (editSlot) bindEditOpen(editSlot, r);

  const resend = main.querySelector('[data-resend]');
  if (resend) resend.addEventListener('click', async () => {
    const select = main.querySelector('#rq-next-hospital');
    if (!select.value) { UI.fieldError(select, 'Choose a different hospital.'); return; }
    const done = UI.busy(resend, 'Sending…');
    try {
      const updated = await API.requests.changeHospital(r.id, Auth.id, select.value);
      if (!updated) throw new Error('This request is no longer available to resend.');
      UI.toast('Request sent to the new hospital.');
      Router.refresh();
    } catch (e) { done(); fail(e); }
  });

  const cancel = main.querySelector('[data-cancel]');
  if (cancel) confirmOnce(cancel, 'Tap again to close', async () => {
    const done = UI.busy(cancel, 'Closing…');
    try {
      await API.requests.cancel(r.id, Auth.id);
      UI.toast('Request cancelled.');
      Router.refresh();
    } catch (e) { done(); fail(e); }
  });

  const reopen = main.querySelector('[data-reopen]');
  if (reopen) reopen.addEventListener('click', async () => {
    const done = UI.busy(reopen, 'Reopening…');
    try {
      const updated = await API.requests.reopen(r.id, Auth.id);
      if (!updated) throw new Error('This request cannot be reopened at its hospital.');
      UI.toast('Request returned to the hospital for review.');
      Router.refresh();
    } catch (e) { done(); fail(e); }
  });

  const cancelAppointment = main.querySelector('[data-cancel-appointment]');
  if (cancelAppointment) cancelAppointment.addEventListener('click', async () => {
    const reason = main.querySelector('[data-cancel-reason]');
    if (!reason.value.trim()) {
      UI.fieldError(reason, 'Add a short cancellation reason.');
      reason.focus();
      return;
    }
    const done = UI.busy(cancelAppointment, 'Cancelling…');
    try {
      await API.appointments.cancel(cancelAppointment.dataset.cancelAppointment, reason.value);
      UI.toast('Appointment cancelled. The volunteer place is open again.');
      Router.refresh();
    } catch (e) { done(); fail(e); }
  });
}

/* patient edits a pending request — same constraints as the create form */
function editFormHtml(r) {
  return `<form id="edit-form" novalidate>
    <p class="eyebrow">Edit request</p>
    <div class="field">
      <label class="label" for="ed-blood">Blood type needed</label>
      <select class="select" id="ed-blood">
        ${BLOOD_TYPES.map(b => `<option value="${b}"${b === r.blood_type ? ' selected' : ''}>${b}</option>`).join('')}
      </select>
    </div>
    <fieldset class="field" style="border:0;padding:0;margin-left:0;margin-right:0">
      <legend class="label" style="padding:0">How urgent is it?</legend>
      <div class="chips" role="group" aria-label="Urgency level">
        ${URGENCIES.map(u => `<button type="button" class="chip" data-ed-urgency="${u}"
          aria-pressed="${u === r.urgency}">${u[0].toUpperCase() + u.slice(1)}</button>`).join('')}
      </div>
    </fieldset>
    <div class="field">
      <label class="label" for="ed-units">Units needed</label>
      <input class="input" id="ed-units" type="number" inputmode="numeric" min="1" step="1" value="${r.units}">
    </div>
    <div class="btn-row">
      <button class="btn btn--primary" type="submit" id="ed-save">Save changes</button>
      <button class="btn btn--soft" type="button" data-editcancel>Cancel</button>
    </div>
  </form>`;
}

function bindEditOpen(slot, r) {
  const btn = slot.querySelector('[data-editopen]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    slot.innerHTML = editFormHtml(r);
    bindEditForm(slot, r);
    const first = document.getElementById('ed-blood');
    if (first) first.focus();
  });
}

function bindEditForm(slot, r) {
  let urgency = r.urgency;
  slot.querySelectorAll('[data-ed-urgency]').forEach(btn => {
    btn.addEventListener('click', () => {
      urgency = btn.dataset.edUrgency;
      slot.querySelectorAll('[data-ed-urgency]').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.edUrgency === urgency)));
    });
  });

  const cancel = slot.querySelector('[data-editcancel]');
  if (cancel) cancel.addEventListener('click', () => {
    slot.innerHTML = `<button class="btn btn--soft btn--block btn--sm" data-editopen="${r.id}">Edit request</button>`;
    bindEditOpen(slot, r);
  });

  const form = document.getElementById('edit-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const units = document.getElementById('ed-units');
    UI.clearErrors(form);
    const n = Number(units.value);
    if (!Number.isInteger(n) || n < 1) {
      UI.fieldError(units, 'Enter a whole number of units, at least 1.');
      units.focus();
      return;
    }
    const done = UI.busy(document.getElementById('ed-save'), 'Saving…');
    try {
      const updated = await API.requests.edit(r.id, {
        blood_type: document.getElementById('ed-blood').value,
        urgency,
        units: n
      });
      if (!updated) throw { message: 'That request is no longer available.' };
      UI.toast('Request updated.');
      Router.refresh();
    } catch (err) { done(); UI.toast(UI.humanError(err), 'bad'); }
  });
}

/* two-step confirmation for destructive buttons */
function confirmOnce(btn, label, fn) {
  if (btn.dataset.confirm === '1') { delete btn.dataset.confirm; fn(); return; }
  const prev = btn.innerHTML;
  btn.dataset.prev = prev;
  btn.dataset.confirm = '1';
  btn.innerHTML = UI.esc(label);
  setTimeout(() => {
    if (btn.isConnected && btn.dataset.confirm === '1') {
      delete btn.dataset.confirm;
      btn.innerHTML = btn.dataset.prev || prev;
    }
  }, 4000);
}

/* used by home + detail: donors volunteer through the hospital */
function bindAcceptDecline(root) {
  root.querySelectorAll('[data-accept]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = Array.from(root.querySelectorAll('[data-precheck-slot]'))
        .find(element => element.dataset.precheckSlot === btn.dataset.accept);
      if (!slot) return;
      slot.innerHTML = donorPrecheckForm();
      bindDonorPrecheck(slot, btn.dataset.accept);
      slot.querySelector('select').focus();
    });
  });
}

function donorPrecheckForm() {
  const today = new Date().toISOString().slice(0, 10);
  const yesNo = (id, label) => `<div class="field">
    <label class="label" for="precheck-${id}">${label}</label>
    <select class="select" id="precheck-${id}" required>
      <option value="">Choose yes or no</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  </div>`;
  return `<form data-donor-precheck novalidate>
    <p class="eyebrow">Volunteer pre-check</p>
    <p class="small muted">This short self-check is not a medical assessment. Answers are saved as flags for you and the hospital for this request.</p>
    <div class="field">
      <label class="label" for="precheck-age">Age range</label>
      <select class="select" id="precheck-age" required>
        <option value="">Choose an age range</option>
        <option value="true">18 years or older</option>
        <option value="false">Under 18 / prefer to ask the hospital</option>
      </select>
    </div>
    <div class="field">
      <label class="label" for="precheck-weight">Weight range</label>
      <select class="select" id="precheck-weight" required>
        <option value="">Choose a weight range</option>
        <option value="true">50 kg or more</option>
        <option value="false">Under 50 kg / prefer to ask the hospital</option>
      </select>
    </div>
    ${yesNo('feeling-well', 'Are you feeling well today?')}
    ${yesNo('recent-illness', 'Have you had a recent illness?')}
    ${yesNo('recent-tattoo', 'Have you had a recent tattoo?')}
    ${yesNo('recent-travel', 'Have you travelled recently?')}
    ${yesNo('medication', 'Are you taking medication?')}
    <div class="field">
      <label class="label" for="precheck-last-donation">Last donation date</label>
      <input class="input" id="precheck-last-donation" type="date" max="${today}">
      <label class="consent-check">
        <input type="checkbox" id="precheck-never-donated">
        <span>I have never donated.</span>
      </label>
    </div>
    <p class="hint">If you are unsure about any answer, ask the hospital before volunteering.</p>
    <div id="precheck-error" aria-live="polite"></div>
    <div class="precheck-result" data-precheck-result aria-live="polite"></div>
    <p class="small muted" style="margin:6px 0 12px">Final eligibility is decided by the hospital's medical screening.</p>
    <button class="btn btn--soft btn--block" type="submit" data-precheck-submit>Check answers</button>
    <button class="btn btn--coral btn--block" type="button" data-precheck-continue hidden>Choose appointment time</button>
  </form>`;
}

function bindDonorPrecheck(slot, requestId) {
  const form = slot.querySelector('[data-donor-precheck]');
  const date = form.querySelector('#precheck-last-donation');
  const never = form.querySelector('#precheck-never-donated');
  const error = form.querySelector('#precheck-error');
  const result = form.querySelector('[data-precheck-result]');
  const submit = form.querySelector('[data-precheck-submit]');
  const continueButton = form.querySelector('[data-precheck-continue]');
  never.addEventListener('change', () => {
    date.disabled = never.checked;
    if (never.checked) date.value = '';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    continueButton.hidden = true;
    if (!form.reportValidity()) return;
    if (!never.checked && !date.value) {
      error.innerHTML = UI.errorBox('Enter your last donation date, or select that you have never donated.');
      date.focus();
      return;
    }
    const parseFlag = id => form.querySelector(`#precheck-${id}`).value === 'true';
    const done = UI.busy(submit, 'Checking…');
    try {
      const response = await API.prechecks.save(requestId, {
        age_18_or_older: parseFlag('age'),
        weight_50kg_or_more: parseFlag('weight'),
        feeling_well: parseFlag('feeling-well'),
        recent_illness: parseFlag('recent-illness'),
        recent_tattoo: parseFlag('recent-tattoo'),
        recent_travel: parseFlag('recent-travel'),
        medication: parseFlag('medication'),
        last_donation_date: date.value || null,
        never_donated: never.checked
      });
      result.textContent = response;
      result.classList.toggle('precheck-result--passed', response === 'Pre-check passed');
      continueButton.hidden = response !== 'Pre-check passed';
      const previousPicker = form.querySelector('[data-slot-picker]');
      if (previousPicker) previousPicker.remove();
      continueButton.textContent = 'Choose appointment time';
      delete continueButton.dataset.confirmSlot;
    } catch (e) {
      error.innerHTML = UI.errorBox(UI.humanError(e));
    } finally {
      done();
    }
  });

  continueButton.addEventListener('click', async () => {
    let picker = form.querySelector('[data-slot-picker]');
    if (!picker) {
      const done = UI.busy(continueButton, 'Loading times…');
      try {
        const window = await API.appointments.getWindow(requestId);
        if (!window) throw new Error('The hospital has not set appointment times for this call yet.');
        const start = new Date(window.window_start);
        const end = new Date(window.window_end);
        const options = [];
        for (let time = start.getTime(); time + window.slot_minutes * 60000 <= end.getTime(); time += window.slot_minutes * 60000) {
          if (time < Date.now()) continue;
          const date = new Date(time);
          options.push(`<option value="${date.toISOString()}">${UI.esc(date.toLocaleString())}</option>`);
        }
        if (!options.length) throw new Error('No future appointment times remain in this window. Contact the hospital through Messages.');
        picker = document.createElement('div');
        picker.className = 'field';
        picker.dataset.slotPicker = 'true';
        picker.innerHTML = `<label class="label">Choose a hospital appointment time</label>
          <select class="select" data-slot-start required><option value="">Choose a time</option>${options.join('')}</select>`;
        continueButton.before(picker);
        continueButton.textContent = 'Confirm appointment';
        continueButton.dataset.confirmSlot = 'true';
      } catch (e) {
        error.innerHTML = UI.errorBox(UI.humanError(e));
      } finally {
        done();
      }
      return;
    }
    const select = picker.querySelector('[data-slot-start]');
    if (!select.value) {
      UI.fieldError(select, 'Choose an appointment time.');
      select.focus();
      return;
    }
    const done = UI.busy(continueButton, 'Booking…');
    try {
      await API.appointments.book(requestId, select.value);
      UI.toast('Your hospital appointment is scheduled.');
      Router.go('#/requests/' + requestId);
    } catch (e) {
      done();
      error.innerHTML = UI.errorBox(UI.humanError(e));
    }
  });
}
