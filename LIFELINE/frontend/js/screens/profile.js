/* Profile: private account details, volunteer call preference and security. */

function profileScreen(main) {
  const me = Auth.profile;
  const user = Auth.user;
  const donor = Auth.isDonor;

  main.innerHTML = `
    <section class="card section">
      <div class="row row--static" style="padding-top:0">
        <span class="avatar" style="width:48px;height:48px;font-size:17px">${UI.esc(UI.initials(me.full_name))}</span>
        <span class="row__main">
          <span class="row__title" style="font-size:17px">${UI.esc(me.full_name || 'Unnamed')}</span>
          <span class="row__sub">${UI.esc(user ? user.email : '')}</span>
        </span>
        <span class="row__side">
          <span class="tag">${donor ? 'Volunteer' : Auth.isHospital ? 'Hospital' : 'Patient'}</span>
        </span>
      </div>
      <div class="inline-actions" style="margin-top:4px">
        ${donor ? '<span class="tag">Hospital screening happens in person</span>'
      : !Auth.isHospital && !Auth.emailConfirmed ? '<span class="tag tag--pink">Confirm your email</span>' : ''}
      </div>
      <p class="small muted" style="margin:10px 0 0">
        ${donor
      ? 'Lifeline does not assess medical eligibility. The hospital screens volunteers on site.'
      : Auth.isHospital ? 'Manage the contact details for your hospital account.'
        : 'Your hospital reviews each request and coordinates next steps.'}
      </p>
    </section>

    <form id="prof-form" class="card section" novalidate>
      <p class="eyebrow">Your details</p>
      <div class="field">
        <label class="label" for="pf-name">Full name</label>
        <input class="input" id="pf-name" type="text" autocomplete="name" value="${UI.esc(me.full_name || '')}">
      </div>
      <div class="field">
        <label class="label" for="pf-phone">Phone number</label>
        <input class="input" id="pf-phone" type="tel" inputmode="tel" autocomplete="tel" value="${UI.esc(me.phone || '')}">
        <p class="hint">Your phone number is not shown to other patients or volunteers.</p>
      </div>
      <div class="field">
        <label class="label" for="pf-address">Address</label>
        <input class="input" id="pf-address" type="text" autocomplete="street-address" value="${UI.esc(me.address || '')}">
      </div>
      <div class="field">
        <label class="label" for="pf-blood">Blood type</label>
        <select class="select" id="pf-blood">
          <option value="">${donor ? 'Not known' : 'Not sure'}</option>
          ${BLOOD_TYPES.map(b => `<option value="${b}"${b === me.blood_type ? ' selected' : ''}>${b}</option>`).join('')}
        </select>
        <p class="hint">${donor ? 'Hospitals may call for volunteers with this blood type.' : 'Your hospital uses this information to review your request.'}</p>
      </div>
      <div id="prof-msg" aria-live="polite"></div>
      <button class="btn btn--primary btn--block" type="submit" id="pf-save">Save changes</button>
    </form>

    ${donor ? donorSection(me) : ''}

    <section class="card section">
      <p class="eyebrow">How Lifeline works</p>
      <p class="small muted">Learn how Lifeline keeps donation voluntary, hospital-led and privacy-focused.</p>
      <button class="btn btn--soft btn--block" type="button" data-go="#/ethics">${UI.icon('info')} View our ethics</button>
    </section>

    <section class="card section">
      <p class="eyebrow">Account</p>
      <div class="field">
        <label class="label" for="pf-pass">New password</label>
        <input class="input" id="pf-pass" type="password" autocomplete="new-password" placeholder="At least 8 characters">
      </div>
      <button class="btn btn--soft btn--block btn--sm" type="button" data-act="chg-pass">${UI.icon('shield')} Change password</button>

      <hr class="divider">
      <div class="field">
        <label class="label" for="pf-email">New email</label>
        <input class="input" id="pf-email" type="email" inputmode="email" autocomplete="email"
               placeholder="${UI.esc(user ? user.email : '')}">
      </div>
      <button class="btn btn--soft btn--block btn--sm" type="button" data-act="chg-email">Change email</button>
      <div id="acct-msg" aria-live="polite" style="margin-top:10px"></div>
    </section>

    <button class="btn btn--danger-ghost btn--block" data-act="signout" type="button">
      ${UI.icon('logout')} Log out</button>`;

  bindProfile(main);
}

function donorSection(me) {
  const active = me.donor_status === 'active';
  const eligibleOn = donorEligibleOn(me.last_donated_at);
  return `
    <section class="card section">
      <p class="eyebrow">Volunteer settings</p>
      <div class="switch-line">
        <span>
          <span class="sl-label">Receive hospital calls</span><br>
          <span class="sl-sub">${active ? 'Hospitals may include you in a call for volunteers' : 'You will not receive new hospital calls'}</span>
        </span>
        <button class="switch" type="button" data-act="pf-status" aria-pressed="${active}"
                aria-label="Toggle availability">${active ? 'On' : 'Off'}</button>
      </div>
      <p class="small muted" style="margin:10px 0 0">The hospital will screen volunteers in person. Lifeline does not collect medical certificates or decide eligibility.</p>
      ${eligibleOn ? `<p class="small" style="margin:8px 0 0">You can volunteer again on ${UI.esc(eligibleOn.toLocaleDateString())}.</p>` : ''}
    </section>`;
}

/* ------------------------------------------------------------ bindings */
function bindProfile(main) {
  const msg = id => document.getElementById(id);
  const fail = (id, e) => { const m = msg(id); if (m) m.innerHTML = UI.errorBox(UI.humanError(e)); };

  const form = document.getElementById('prof-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    UI.clearErrors(form);
    const name = document.getElementById('pf-name');
    const phone = document.getElementById('pf-phone');
    let ok = true;
    if (!name.value.trim()) { UI.fieldError(name, 'Enter your full name.'); ok = false; }
    const phoneVal = phone.value.trim();
    if (phoneVal && !/^[+\d][\d\s()-]{5,}$/.test(phoneVal)) {
      UI.fieldError(phone, 'Use digits only, for example +1 555 010 2030.'); ok = false;
    }
    if (!ok) { form.querySelector('[aria-invalid="true"]').focus(); return; }

    const done = UI.busy(document.getElementById('pf-save'), 'Saving…');
    try {
      await Auth.saveProfile({
        full_name: name.value.trim(),
        phone: phoneVal || null,
        address: document.getElementById('pf-address').value.trim() || null,
        blood_type: document.getElementById('pf-blood').value || null
      });
      UI.toast('Profile saved.');
      Router.refresh();
    } catch (e) { done(); fail('prof-msg', e); }
  });

  const status = main.querySelector('[data-act="pf-status"]');
  if (status) status.addEventListener('click', async () => {
    const done = UI.busy(status, '…');
    try {
      const next = Auth.profile.donor_status === 'active' ? 'inactive' : 'active';
      await Auth.saveProfile({ donor_status: next });
      UI.toast(next === 'active' ? 'You are open to hospital calls.' : 'You are off duty.');
      Router.refresh();
    } catch (e) { done(); fail('prof-msg', e); }
  });

  const passBtn = main.querySelector('[data-act="chg-pass"]');
  if (passBtn) passBtn.addEventListener('click', async () => {
    const input = document.getElementById('pf-pass');
    UI.fieldError(input, '');
    if (!UI.isStrong(input.value)) {
      UI.fieldError(input, 'Use 8+ characters with upper and lower case letters and a number.');
      input.focus();
      return;
    }
    const done = UI.busy(passBtn, 'Saving…');
    try {
      await API.auth.updatePassword(input.value);
      input.value = '';
      UI.toast('Password updated.');
      const m = msg('acct-msg');
      if (m) m.innerHTML = '';
    } catch (e) { done(); fail('acct-msg', e); }
  });

  const emailBtn = main.querySelector('[data-act="chg-email"]');
  if (emailBtn) emailBtn.addEventListener('click', async () => {
    const input = document.getElementById('pf-email');
    UI.fieldError(input, '');
    const v = input.value.trim();
    if (!UI.isEmail(v)) { UI.fieldError(input, 'Enter a valid email address.'); input.focus(); return; }
    const done = UI.busy(emailBtn, 'Sending…');
    try {
      await API.auth.updateEmail(v);
      const m = msg('acct-msg');
      if (m) m.innerHTML = `<div class="notice">${UI.icon('info')}<span>Check <b>${UI.esc(v)}</b> and confirm the link to finish the change.</span></div>`;
      input.value = '';
    } catch (e) { done(); fail('acct-msg', e); }
  });

  const out = main.querySelector('[data-act="signout"]');
  if (out) confirmOnce(out, 'Tap again to log out', () => Auth.signOut());
}
