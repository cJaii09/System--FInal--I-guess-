/* Emergency screen — urgent requests go to the hospital before volunteer calls. */

async function emergencyScreen(main) {
  main.innerHTML = UI.loading(3);
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
  const me = Auth.profile;
  const mine = appointments.map(appointment => ({
    ...(appointment.request || {}),
    id: appointment.request_id,
    status: appointment.request && appointment.request.status === 'completed'
      ? 'completed' : appointment.status === 'cancelled' ? 'cancelled' : 'accepted',
    appointment
  }));
  main.innerHTML = Auth.isDonor ? donorEmergency(me, all, mine) : patientEmergency(me, all);
  bindEmergency(main);
}

function patientEmergency(me, all) {
  const mine = all.filter(r => r.urgency === 'emergency');
  const open = mine.filter(r => ['pending_hospital', 'pending', 'hospital_declined'].includes(r.status));
  const matched = mine.filter(r => ['accepted', 'completed'].includes(r.status));

  return `
    <section class="section">
      <span class="emerg-badge">${UI.icon('alert')} Emergency</span>
      <h1 style="color:#fff;margin-top:12px">Blood needed right now</h1>
      <p class="lede">Send an emergency request for ${UI.esc(me.blood_type || 'your blood type')}.
      Your selected hospital reviews it first and coordinates a call for voluntary donors.</p>
    </section>

    <button class="btn btn--coral btn--block section" data-act="emerg-new">
      ${UI.icon('alert')} Send emergency request
    </button>

    <section class="section" aria-labelledby="em-open">
      <p class="eyebrow" id="em-open">Your emergency requests</p>
      ${open.length || matched.length ? open.map(r => emergMineCard(r)).join('') + matched.map(r => emergMineCard(r)).join('')
      : `<div class="emerg-card">
          <p class="emerg-title">Nothing open yet</p>
          <p class="emerg-sub">Your emergency requests will appear here with their live status.</p>
        </div>`}
    </section>`;
}

function emergMineCard(r) {
  const appointmentStatus = r.appointment && r.appointment.status;
  const appointmentTag = appointmentStatus === 'donated' ? '<span class="tag">Donation recorded</span>'
    : appointmentStatus === 'deferred' ? '<span class="tag">Deferred</span>'
      : appointmentStatus === 'no_show' ? '<span class="tag">No-show</span>'
        : appointmentStatus === 'cancelled' ? '<span class="tag">Cancelled</span>' : null;
  return `<article class="emerg-card">
    <div class="row-between">
      <span class="emerg-title">${r.units} unit${r.units === 1 ? '' : 's'} · ${UI.esc(r.blood_type)}</span>
      ${appointmentTag || (r.status === 'accepted'
        ? `<span class="tag"><span class="dot dot--green"></span>${r.volunteer_count || 0} of ${r.units} volunteers confirmed</span>`
        : r.status === 'hospital_declined' ? '<span class="tag tag--red">Hospital declined</span>'
          : r.status === 'pending_hospital' ? '<span class="tag">Hospital review</span>'
            : r.status === 'completed' ? '<span class="tag">Completed</span>'
              : '<span class="tag tag--red">Hospital calling volunteers</span>')}
    </div>
    <p class="emerg-sub">${UI.esc(hospitalName(r))}${hospitalAddress(r) ? ` · ${UI.esc(hospitalAddress(r))}` : ''} · ${UI.timeAgo(r.created_at)}</p>
    ${r.status === 'hospital_declined' && r.hospital_note ? `<p class="emerg-sub">${UI.esc(r.hospital_note)}</p>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn--soft btn--sm" data-go="#/requests/${r.id}">Open request</button>
    </div>
  </article>`;
}

function donorEmergency(me, all, appointments) {
  const open = all.filter(r => r.status === 'pending' && r.urgency === 'emergency');
  const mine = appointments.filter(r => r.urgency === 'emergency');
  const state = donorState(me);

  return `
    <section class="section">
      <span class="emerg-badge">${UI.icon('alert')} Emergency</span>
      <h1 style="color:#fff;margin-top:12px">Emergency hospital calls</h1>
      <p class="lede">Hospitals may call voluntary donors with ${UI.esc(me.blood_type || 'your blood type')} for urgent requests.</p>
      <div class="emerg-stat">
        <div class="stat"><div class="stat__val">${open.length}</div><div class="stat__key">Need you now</div></div>
        <div class="stat"><div class="stat__val">${mine.length}</div><div class="stat__key">Your commitments</div></div>
        <div class="stat"><div class="stat__val">${UI.esc(me.blood_type || '—')}</div><div class="stat__key">Your type</div></div>
      </div>
    </section>

    ${me.donor_status !== 'active' ? `
    <div class="emerg-card section">
      <p class="emerg-title">You are off duty</p>
      <p class="emerg-sub">Switch on when you are ready to receive hospital calls.</p>
      <button class="btn btn--coral btn--block btn--sm" style="margin-top:10px" data-act="emerg-online">
        ${UI.icon('check')} Make me available</button>
    </div>` : `
    <div class="emerg-card section">
      <p class="emerg-title"><span class="dot ${state.dot}"></span> ${UI.esc(state.label)}</p>
      <p class="emerg-sub">${me.donor_status === 'active'
      ? 'Hospital emergency calls will appear here.'
      : 'Turn on hospital calls when you are ready to volunteer.'}</p>
    </div>`}

    <section class="section" aria-labelledby="em-list">
      <p class="eyebrow" id="em-list">Urgent calls for volunteers</p>
      ${open.length
      ? open.map(donorEmergCard).join('')
      : `<div class="emerg-card">
          <p class="emerg-title">No urgent calls for ${UI.esc(me.blood_type || 'your type')} right now</p>
          <p class="emerg-sub">Urgent calls appear here after the hospital reviews them.</p>
        </div>`}
    </section>

    ${mine.length ? `
    <section class="section" aria-labelledby="em-mine">
      <p class="eyebrow" id="em-mine">You are donating</p>
      ${mine.map(r => emergMineCard(r)).join('')}
    </section>` : ''}`;
}

function donorEmergCard(r) {
  const cooldown = donorCooldownMessage();
  return `<article class="emerg-card">
    <div class="row-between">
      <span class="emerg-title">${r.units} unit${r.units === 1 ? '' : 's'} · ${UI.esc(r.blood_type)}</span>
      <span class="emerg-sub">${UI.timeAgo(r.created_at)}</span>
    </div>
    <p class="emerg-sub">${UI.esc(hospitalName(r))}${hospitalAddress(r) ? ` · ${UI.esc(hospitalAddress(r))}` : ''}</p>
    ${cooldown
      ? `<p class="emerg-sub">${UI.esc(cooldown)}</p>`
      : `<div class="btn-row" style="margin-top:12px">
          <button class="btn btn--coral btn--sm" data-accept="${UI.esc(r.id)}">${UI.icon('check')} Volunteer at this hospital</button>
        </div><div data-precheck-slot="${UI.esc(r.id)}"></div>`}
  </article>`;
}

function bindEmergency(main) {
  bindAcceptDecline(main);

  const fresh = main.querySelector('[data-act="emerg-new"]');
  if (fresh) fresh.addEventListener('click', () => {
    newReqPreset = 'emergency';
    Router.go('#/requests/new');
  });

  const online = main.querySelector('[data-act="emerg-online"]');
  if (online) online.addEventListener('click', async () => {
    const done = UI.busy(online, 'Saving…');
    try {
      await Auth.saveProfile({ donor_status: 'active' });
      UI.toast('You are available. Emergency alerts will land here.');
      Router.refresh();
    } catch (e) { done(); UI.toast(UI.humanError(e), 'bad'); }
  });
}
