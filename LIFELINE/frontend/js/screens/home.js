/* Role-based home: hospital volunteer registry, calls and request progress. */

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function donorState(d) {
  if (d.donor_status !== 'active') return { dot: 'dot--muted', label: 'Off duty' };
  return { dot: 'dot--green', label: 'Open to hospital calls' };
}

async function homeScreen(main) {
  main.innerHTML = UI.loading(4);
  const me = Auth.profile;
  try {
    if (Auth.isHospital) await renderHospitalHome(main, me);
    else if (Auth.isDonor) await renderDonorHome(main, me);
    else await renderPatientHome(main, me);
  } catch (e) {
    console.error(e);
    main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
  }
}

async function renderHospitalHome(main, me) {
  const [requests, volunteers] = await Promise.all([
    API.requests.list(),
    API.views.volunteerRegistry()
  ]);
  const incoming = requests.filter(r => r.status === 'pending_hospital');
  const urgent = incoming.filter(r => r.urgency === 'emergency').length;
  const registry = BLOOD_TYPES.map(type => {
    const count = volunteers.find(row => row.blood_type === type);
    return `<div class="stat"><div class="stat__val">${count ? count.volunteer_count : 0}</div>
      <div class="stat__key">${type}</div></div>`;
  }).join('');
  main.innerHTML = `
    <section class="section">
      <h1>Welcome, ${UI.esc(firstName(me.full_name))}.</h1>
      <p class="lede">Review patient requests, then call on voluntary donors through the hospital.</p>
    </section>
    <button class="card card--alert section" data-go="#/hospital"
      style="width:100%;text-align:left;cursor:pointer">
      <div class="row-between">
        <span class="row__title">${incoming.length} incoming request${incoming.length === 1 ? '' : 's'}</span>
        ${urgent ? '<span class="tag tag--red">URGENT</span>' : ''}
      </div>
      <p class="small" style="margin:4px 0 0;color:var(--charcoal-text)">Open the Requests tab to approve or decline.</p>
    </button>
    <section class="card section" aria-labelledby="volunteer-registry">
      <p class="eyebrow" id="volunteer-registry">Registered active volunteers by blood type</p>
      <p class="small muted">Registry counts only; this is not blood inventory or a guarantee of availability.</p>
      <div class="volunteer-registry">${registry}</div>
    </section>`;
}

/* ---------------------------------------------------------------- patient */
async function renderPatientHome(main, me) {
  const all = await API.requests.list();
  const mine = all.slice(0, 3);

  main.innerHTML = `
    <section class="section">
      <h1>Hi, ${UI.esc(firstName(me.full_name))}.</h1>
      <p class="lede">Need blood? Send a request to a hospital. The hospital will review it and coordinate a call for voluntary donors.</p>
    </section>

    <div class="btn-row section">
      <button class="btn btn--primary" data-go="#/requests/new">${UI.icon('drop')} Request blood</button>
      <button class="btn btn--outline" data-go="#/emergency">${UI.icon('alert')} Emergency</button>
    </div>

    <section class="section" aria-labelledby="mine-h">
      <div class="row-between" style="margin-bottom:8px">
        <p class="eyebrow" id="mine-h" style="margin:0">Your requests</p>
        ${all.length ? '<button class="link-btn" data-go="#/requests">See all</button>' : ''}
      </div>
      ${mine.length
      ? `<ul class="list card">${mine.map(r => patientRow(r)).join('')}</ul>`
      : UI.empty('No requests yet', 'Your blood requests will show up here.',
        '<button class="btn btn--primary" data-go="#/requests/new">Request blood</button>')}
    </section>`;
}

function patientRow(r) {
  const tag = r.status === 'accepted' ? `<span class="tag"><span class="dot dot--green"></span>Appointment confirmed</span>`
    : r.status === 'hospital_declined' ? '<span class="tag tag--red">Hospital declined</span>'
      : r.status === 'pending_hospital' ? '<span class="tag"><span class="dot dot--amber"></span>Hospital review</span>'
        : r.status === 'completed' ? '<span class="tag">Completed</span>'
          : r.status === 'declined' || r.status === 'cancelled' ? '<span class="tag">Closed</span>'
            : `<span class="tag"><span class="dot dot--amber"></span>${Number(r.volunteer_count || 0)} of ${r.units} volunteers</span>`;
  return `<li><button class="row" data-go="#/requests/${r.id}">
    <span class="avatar avatar--blood">${UI.esc(r.blood_type)}</span>
    <span class="row__main">
      <span class="row__title">${r.units} unit${r.units === 1 ? '' : 's'} ${urgencyTag(r.urgency)}</span>
      <span class="row__sub">${UI.esc(hospitalName(r))} · ${UI.timeAgo(r.created_at)}</span>
    </span>
    <span class="row__side">${tag}${UI.icon('chevron')}</span>
  </button></li>`;
}

/* ------------------------------------------------------------------ donor */
async function renderDonorHome(main, me) {
  const [all, appointments] = await Promise.all([API.requests.list(), API.appointments.mine()]);
  const open = all.filter(r => r.status === 'pending');
  const mine = appointments.map(appointment => ({
    ...(appointment.request || {}),
    id: appointment.request_id,
    status: appointment.request && appointment.request.status === 'completed'
      ? 'completed' : appointment.status === 'cancelled' ? 'cancelled' : 'accepted',
    appointment
  }));
  const emergencies = open.filter(r => r.urgency === 'emergency');
  const active = me.donor_status === 'active';
  const state = donorState(me);

  main.innerHTML = `
    <section class="card section" aria-labelledby="avail-h">
      <div class="row-between">
        <div>
          <p class="eyebrow" id="avail-h" style="margin:0 0 4px">Your status</p>
          <div class="row__title" style="font-size:16px"><span class="dot ${state.dot}"></span>${state.label}</div>
        </div>
        <button class="switch" data-act="toggle-status" aria-pressed="${active}">
          ${active ? 'Available' : 'Off duty'}
        </button>
      </div>
      <p class="small muted" style="margin:8px 0 0">
        ${active ? 'Hospitals may include you when they call for voluntary donors.' : 'You will not receive new hospital calls while off duty.'}
      </p>
      <hr class="divider">
      <p class="small muted" style="margin:0">Blood type: <strong>${UI.esc(me.blood_type || '—')}</strong></p>
      <div class="stack" style="margin-top:12px">
        <p class="small muted" style="margin:0;text-align:center">The hospital screens volunteers in person.</p>
      </div>
      <div id="donor-msg" aria-live="polite"></div>
    </section>

    ${emergencies.length ? `<button class="card card--alert section" data-go="#/emergency"
        style="width:100%;text-align:left;cursor:pointer" aria-label="Open emergency requests">
      <div class="row__title" style="color:var(--lifeline-red)">${UI.icon('alert')} ${emergencies.length} emergency request${emergencies.length === 1 ? '' : 's'} for your blood type</div>
      <p class="small" style="margin:4px 0 0;color:var(--charcoal-text)">Open the emergency screen to respond now.</p>
    </button>` : ''}

    <section class="section" aria-labelledby="open-h">
      <p class="eyebrow" id="open-h">Hospital calls for ${UI.esc(me.blood_type || 'your blood type')}</p>
      ${open.length
      ? `<div class="stack">${open.map(openRequestCard).join('')}</div>`
      : UI.empty('No hospital calls yet', 'A hospital call for your blood type will appear here after the hospital reviews a request.')}
    </section>

    <section class="section" aria-labelledby="mine-h">
      <p class="eyebrow" id="mine-h">Your volunteer responses</p>
      ${mine.length
      ? `<ul class="list card">${mine.map(r => donorMineRow(r)).join('')}</ul>`
      : UI.empty('No responses yet', 'Hospital calls you volunteer for will appear here so you can coordinate with the hospital.')}
    </section>`;

  bindDonorHome(main);
}

function openRequestCard(r) {
  const cooldown = donorCooldownMessage();
  return `<article class="card card--flat">
    <button class="row" data-go="#/requests/${r.id}" style="padding-top:0">
      <span class="avatar avatar--blood">${UI.esc(r.blood_type)}</span>
      <span class="row__main">
        <span class="row__title">${r.units} unit${r.units === 1 ? '' : 's'} ${urgencyTag(r.urgency)}</span>
        <span class="row__sub">${UI.esc(hospitalName(r))}${hospitalAddress(r) ? ` · ${UI.esc(hospitalAddress(r))}` : ''} · ${UI.timeAgo(r.created_at)}</span>
      </span>
      <span class="row__side">${UI.icon('chevron')}</span>
    </button>
    ${cooldown
      ? `<p class="small muted">${UI.esc(cooldown)}</p>`
      : `<div class="btn-row" style="margin-top:4px">
          <button class="btn btn--coral btn--sm" data-accept="${UI.esc(r.id)}">${UI.icon('check')} Volunteer at this hospital</button>
        </div>
        <div data-precheck-slot="${UI.esc(r.id)}"></div>`}
  </article>`;
}

function donorMineRow(r) {
  const appointmentStatus = r.appointment && r.appointment.status;
  const st = appointmentStatus === 'donated'
    ? '<span class="tag">Donation recorded</span>'
    : appointmentStatus === 'deferred' ? '<span class="tag">Deferred</span>'
      : appointmentStatus === 'no_show' ? '<span class="tag">No-show</span>'
        : appointmentStatus === 'cancelled' ? '<span class="tag">Cancelled</span>'
        : r.status === 'completed' ? '<span class="tag">Completed</span>'
          : '<span class="tag"><span class="dot dot--green"></span>Appointment scheduled</span>';
  return `<li><button class="row" data-go="#/requests/${r.id}">
    <span class="avatar avatar--blood">${UI.esc(r.blood_type || '')}</span>
    <span class="row__main">
    <span class="row__title">${UI.esc(hospitalName(r))} ${urgencyTag(r.urgency)}</span>
    <span class="row__sub">${UI.esc(r.blood_type || '')} · ${r.appointment ? UI.esc(new Date(r.appointment.slot_start).toLocaleString()) : UI.timeAgo(r.created_at)}</span>
    </span>
    <span class="row__side">${st}${UI.icon('chevron')}</span>
  </button></li>`;
}

function bindDonorHome(main) {
  const msg = document.getElementById('donor-msg');
  const toggle = main.querySelector('[data-act="toggle-status"]');
  if (toggle) toggle.addEventListener('click', async () => {
    const next = Auth.profile.donor_status === 'active' ? 'inactive' : 'active';
    const done = UI.busy(toggle, 'Saving…');
    try {
      await Auth.saveProfile({ donor_status: next });
      UI.toast(next === 'active' ? 'You are available now.' : 'You are off duty.');
      Router.refresh();
    } catch (e) {
      done();
      if (msg) msg.innerHTML = UI.errorBox(UI.humanError(e));
    }
  });

  bindAcceptDecline(main);
}
