/* Log in / Sign up. Signup metadata is what handle_new_user() reads to build
   the profiles row, so the field names here match the trigger exactly. */

let authTab = 'login';        // 'login' | 'signup' | 'sent'
let authRole = 'patient';     // Public sign-up is for patients and volunteers.
let authRequestInFlight = false;
let authRetryBlockedUntil = 0;

function authScreen(main) {
  main.innerHTML = `<div class="auth">
    <div class="auth__brand">
      <img class="auth__logo" src="assets/logo.jpg" alt="Lifeline logo">
      <div>
        <div class="auth__name">Lifeline</div>
        <p class="auth__tag">Blood when it matters.</p>
      </div>
    </div>
    <div id="auth-body"></div>
  </div>`;
  paintAuth();
}

function paintAuth(message, kind) {
  const body = document.getElementById('auth-body');
  if (!body) return;

  if (authTab === 'sent') {
    body.innerHTML = `<div class="card">
      <div class="row__title">${UI.icon('check')} Check your email</div>
      <p class="lede">We sent a confirmation link to <b>${UI.esc(authSentEmail)}</b>.
      Tap it, then come back and log in. Patient profiles are verified automatically
      once the email is confirmed.</p>
      <div class="stack" style="margin-top:14px">
        <button class="btn btn--primary btn--block" data-auth="to-login">I've confirmed — log in</button>
      </div>
    </div>`;
    bindAuth();
    return;
  }

  const signup = authTab === 'signup';
  body.innerHTML = `
    <div class="segment" role="group" aria-label="Sign in or sign up">
      <button type="button" data-auth="login" aria-pressed="${!signup}">Log in</button>
      <button type="button" data-auth="signup" aria-pressed="${signup}">Sign up</button>
    </div>
    ${message ? `<div class="notice ${kind === 'ok' ? '' : 'notice--error'}" role="${kind === 'ok' ? 'status' : 'alert'}" style="margin-bottom:14px">
      ${UI.icon(kind === 'ok' ? 'check' : 'info')}<span>${UI.esc(message)}</span></div>` : ''}
    <div class="card" style="margin-bottom:14px">
      <p class="eyebrow" style="margin:0 0 8px">Demo accounts</p>
      <div class="stack" style="gap:8px">
        <button class="btn btn--soft btn--block" type="button" data-demo="patient">Patient demo · patient@demo.com</button>
        <button class="btn btn--soft btn--block" type="button" data-demo="mary">Patient thread demo · mary@demo.com</button>
        <button class="btn btn--soft btn--block" type="button" data-demo="donor">Donor demo · donor@demo.com</button>
        <button class="btn btn--soft btn--block" type="button" data-demo="hospital">Hospital demo · hospital@demo.com</button>
      </div>
    </div>
    <form id="auth-form" novalidate>
      ${signup ? signupFields() : ''}
      <div class="field">
        <label class="label" for="au-email">Email</label>
        <input class="input" id="au-email" name="email" type="email" inputmode="email"
               autocomplete="email" placeholder="you@example.com" required>
      </div>
      <div class="field">
        <label class="label" for="au-pass">Password</label>
        <input class="input" id="au-pass" name="password" type="password"
               autocomplete="${signup ? 'new-password' : 'current-password'}"
               placeholder="${signup ? 'At least 8 characters' : 'Your password'}" required>
        ${signup ? '<p class="hint">Use 8+ characters with upper and lower case letters and a number.</p>' : ''}
      </div>
      <button class="btn btn--primary btn--block" type="submit" id="auth-submit">
        ${signup ? 'Create account' : 'Log in'}
      </button>
    </form>
    <p class="small muted center" style="margin-top:16px">
      ${signup ? 'Already have an account? ' : 'New here? '}
      <button class="link-btn" type="button" data-auth="${signup ? 'login' : 'signup'}">
        ${signup ? 'Log in' : 'Create one'}</button>
    </p>`;
  bindAuth();
}

let authSentEmail = '';

function signupFields() {
  const donor = authRole === 'donor';
  return `
    <div class="role-pick" role="group" aria-label="Choose your role">
      <button type="button" data-role="patient" aria-pressed="${!donor}">
        <span class="rp-icon">${UI.icon('drop')}</span>
        <span><span class="rp-title">I need blood</span><br>
        <span class="rp-sub">Request blood for me or someone I care for</span></span>
      </button>
      <button type="button" data-role="donor" aria-pressed="${donor}">
        <span class="rp-icon">${UI.icon('medical')}</span>
        <span><span class="rp-title">I want to donate</span><br>
        <span class="rp-sub">Hospitals may call for volunteers with this blood type</span></span>
      </button>
    </div>
    <div class="field">
      <label class="label" for="au-name">Full name</label>
      <input class="input" id="au-name" type="text" autocomplete="name" placeholder="As on your ID" required>
    </div>
    <div class="field">
      <label class="label" for="au-phone">Phone number</label>
      <input class="input" id="au-phone" type="tel" inputmode="tel" autocomplete="tel"
             placeholder="+1 555 010 2030" required>
      <p class="hint">Your phone number is private from donors and patients; use Messages to coordinate with the hospital.</p>
    </div>
    <div class="field">
      <label class="label" for="au-address">Address</label>
      <input class="input" id="au-address" type="text" autocomplete="street-address"
             placeholder="Street and neighbourhood">
    </div>
    <div id="blood-wrap"></div>
    <div id="donor-consent-wrap"></div>`;
}

function bindAuth() {
  document.querySelectorAll('[data-auth]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.auth;
      if (v === 'login' || v === 'signup') { authTab = v; paintAuth(); }
      if (v === 'to-login') { authTab = 'login'; paintAuth(); }
    });
  });
  document.querySelectorAll('[data-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      authRole = btn.dataset.role;
      document.querySelectorAll('[data-role]').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.role === authRole)));
      paintBloodField();            /* toggle in place so nothing typed is lost */
      paintDonorConsentField();
    });
  });

  document.querySelectorAll('[data-demo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const map = {
        patient: { email: 'patient@demo.com', password: 'Demo123!' },
        mary: { email: 'mary@demo.com', password: 'Demo123!' },
        donor: { email: 'donor@demo.com', password: 'Demo123!' },
        hospital: { email: 'hospital@demo.com', password: 'Demo123!' }
      };
      const row = map[btn.dataset.demo];
      if (!row) return;
      const done = UI.busy(btn, 'Logging in…');
      try {
        await Auth.demoLogin(row.email, row.password);
        Router.go('#/home');
        Router.render();
      } catch (e) {
        paintAuth(UI.humanError(e), 'bad');
      }
      done();
    });
  });

  const form = document.getElementById('auth-form');
  if (form) form.addEventListener('submit', onAuthSubmit);
  ['au-email', 'au-pass', 'au-name', 'au-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('blur', () => validateAuthField(el));
  });
  paintBloodField();
  paintDonorConsentField();
}

/* the blood-type field only exists for donors — toggled in place on purpose */
function paintBloodField() {
  const wrap = document.getElementById('blood-wrap');
  if (!wrap) return;
  if (authRole !== 'donor') { wrap.innerHTML = ''; return; }
  if (document.getElementById('au-blood')) return;
  wrap.innerHTML = `
    <div class="field">
      <label class="label" for="au-blood">Blood type</label>
      <select class="select" id="au-blood" required>
        <option value="">Choose your blood type</option>
        ${BLOOD_TYPES.map(b => `<option value="${b}">${b}</option>`).join('')}
      </select>
      <p class="hint">Hospitals may call for volunteers with this blood type.</p>
    </div>`;
  const el = document.getElementById('au-blood');
  el.addEventListener('blur', () => validateAuthField(el));
}

function paintDonorConsentField() {
  const wrap = document.getElementById('donor-consent-wrap');
  if (!wrap) return;
  if (authRole !== 'donor') { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="notice notice--warn" style="margin-bottom:10px">
      ${UI.icon('info')}<span>Donation is voluntary and unpaid. The hospital makes the final medical decision, and only the minimum coordination details are shared with it.</span>
    </div>
    <label class="consent-check">
      <input type="checkbox" id="au-donor-consent">
      <span>I will not accept or ask for payment, and I agree to share only the minimum information needed with the hospital.</span>
    </label>
    <div id="au-donor-consent-error"></div>`;
}

function validateAuthField(el) {
  const v = el.value.trim();
  if (el.id === 'au-email') {
    UI.fieldError(el, !v ? 'Enter your email address.' : (!UI.isEmail(v) ? 'That email address does not look right.' : ''));
    return el.getAttribute('aria-invalid') !== 'true';
  }
  if (el.id === 'au-pass') {
    UI.fieldError(el, !v ? 'Enter your password.'
      : (authTab === 'signup' && !UI.isStrong(v) ? 'Use 8+ characters with upper and lower case letters and a number.' : ''));
    return el.getAttribute('aria-invalid') !== 'true';
  }
  if (el.id === 'au-name') { UI.fieldError(el, !v ? 'Enter your full name.' : ''); return !v ? false : true; }
  if (el.id === 'au-phone') {
    UI.fieldError(el, !v ? 'Enter a phone number.' : (!/^[+\d][\d\s()-]{5,}$/.test(v) ? 'Use digits only, for example +1 555 010 2030.' : ''));
    return el.getAttribute('aria-invalid') !== 'true';
  }
  if (el.id === 'au-blood') { UI.fieldError(el, !v ? 'Choose your blood type.' : ''); return !!v; }
  if (el.id === 'au-donor-consent') {
    const error = document.getElementById('au-donor-consent-error');
    const accepted = el.checked;
    if (error) error.textContent = accepted ? '' : 'Please confirm the donor consent statement.';
    return accepted;
  }
  return true;
}

async function onAuthSubmit(e) {
  e.preventDefault();

  const now = Date.now();
  if (authRequestInFlight) return;
  if (now < authRetryBlockedUntil) {
    paintAuth('Too many attempts. Wait a moment and try again.', 'bad');
    return;
  }

  const submit = document.getElementById('auth-submit');
  const fields = ['au-email', 'au-pass']
    .concat(authTab === 'signup'
      ? ['au-name', 'au-phone', 'au-blood'].concat(authRole === 'donor' ? ['au-donor-consent'] : [])
      : [])
    .map(id => document.getElementById(id)).filter(Boolean);

  let ok = true;
  fields.forEach(el => { if (!validateAuthField(el)) ok = false; });
  if (!ok) {
    const first = document.querySelector('[aria-invalid="true"]');
    if (first) first.focus();
    return;
  }

  authRequestInFlight = true;
  const done = UI.busy(submit, authTab === 'signup' ? 'Creating…' : 'Logging in…');
  const email = document.getElementById('au-email').value.trim();
  const password = document.getElementById('au-pass').value;

  try {
    if (authTab === 'login') {
      await Auth.signIn(email, password);
      Router.go('#/home');
      Router.render();
    } else {
      const res = await Auth.signUp({
        email, password, role: authRole,
        full_name: document.getElementById('au-name').value.trim(),
        phone: document.getElementById('au-phone').value.trim(),
        address: document.getElementById('au-address').value.trim() || null,
        blood_type: document.getElementById('au-blood') ? document.getElementById('au-blood').value : null,
        donor_consent_accepted: authRole === 'donor' &&
          !!(document.getElementById('au-donor-consent') &&
            document.getElementById('au-donor-consent').checked),
        donor_consent_version: authRole === 'donor' ? API.donorConsentVersion : null
      });
      if (res.session) {
        Router.go('#/home');
        Router.render();
      } else {
        authSentEmail = email;
        authTab = 'sent';
        paintAuth();
      }
    }
  } catch (err) {
    const message = UI.humanError(err);
    if (/Too many attempts/i.test(message)) {
      authRetryBlockedUntil = Date.now() + 15000;
    }
    paintAuth(message, 'bad');
    return;
  } finally {
    authRequestInFlight = false;
    done();
  }
}
