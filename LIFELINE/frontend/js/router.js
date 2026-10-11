/* Hash router + app shell (top bar, content, bottom navigation). */

const Router = (() => {
  const ROUTES = [
    { re: /^\/login$/, screen: 'authScreen', chrome: 'bare' },
    { re: /^\/$/, screen: 'homeScreen', chrome: 'app', tab: 'home', title: 'Lifeline', brand: true },
    { re: /^\/requests$/, screen: 'requestsScreen', chrome: 'app', tab: 'requests', title: 'Requests' },
    { re: /^\/hospital$/, screen: 'hospitalScreen', chrome: 'app', tab: 'requests', title: 'Incoming requests' },
    { re: /^\/requests\/new$/, screen: 'newRequestScreen', chrome: 'app', tab: 'requests', title: 'New request', back: '#/requests' },
    { re: /^\/requests\/([0-9a-zA-Z-]{1,40})$/, screen: 'requestDetailScreen', chrome: 'app', tab: 'requests', title: 'Request', back: '#/requests' },
    { re: /^\/emergency$/, screen: 'emergencyScreen', chrome: 'app', tab: 'emergency', title: 'Emergency' },
    { re: /^\/profile$/, screen: 'profileScreen', chrome: 'app', tab: 'profile', title: 'Profile' },
    { re: /^\/ethics$/, screen: 'ethicsScreen', chrome: 'app', tab: 'profile', title: 'How Lifeline works', back: '#/profile' },
    { re: /^\/donor-consent$/, screen: 'donorConsentScreen', chrome: 'bare', title: 'Donor consent' }
  ];

  const TABS = [
    { id: 'home', href: '#/home', label: 'Home', icon: 'home' },
    { id: 'requests', href: '#/requests', label: 'Requests', icon: 'list' },
    { id: 'emergency', href: '#/emergency', label: 'Emergency', icon: 'alert' },
    { id: 'profile', href: '#/profile', label: 'Profile', icon: 'user' }
  ];

  let liveOff = null;      // realtime unsubscribe
  let lastPath = null;     // to tell navigation from a refresh

  const path = () => {
    const raw = (location.hash || '#/').replace(/^#/, '');
    return (raw.split('?')[0] || '/');
  };
  const go = href => { if (location.hash !== href) location.hash = href; else render(); };

  function match(p) {
    for (const r of ROUTES) {
      const m = p.match(r.re);
      if (m) return { route: r, params: m.slice(1) };
    }
    return null;
  }

  /* ---------- shell ---------- */
  function header(route) {
    if (route.back) {
      return `<header class="topbar">
        <button class="icon-btn" data-go="${route.back}" aria-label="Go back">${UI.icon('back')}</button>
        <span class="topbar__title">${UI.esc(route.title)}</span>
        <span class="topbar__spacer"></span>
      </header>`;
    }
    if (route.brand) {
      return `<header class="topbar">
        <span class="topbar__brand">
          <img class="topbar__logo" src="assets/logo.jpg" alt="">
          <span class="topbar__title">Lifeline</span>
        </span>
        <span class="topbar__spacer"></span>
        <span class="topbar__actions">
          <button class="icon-btn" data-go="#/profile" aria-label="Your profile">${UI.icon('user')}</button>
        </span>
      </header>`;
    }
    return `<header class="topbar"><span class="topbar__title">${UI.esc(route.title)}</span></header>`;
  }

  function tabbar(active) {
    const tabs = Auth.isHospital
      ? [TABS[0], { ...TABS[1], href: '#/hospital' }, TABS[3]]
      : TABS;
    return `<nav class="tabbar" aria-label="Main sections">${tabs.map(t => `
      <button class="tab" data-go="${t.href}" ${t.id === active ? 'aria-current="page"' : ''}>
        ${UI.icon(t.icon)}<span>${t.label}</span>${Auth.isHospital && t.id === 'requests' ? '<span class="tab__badge" data-hospital-badge hidden></span>' : ''}
      </button>`).join('')}</nav>`;
  }

  function offlineBar() {
    return navigator.onLine ? '' :
      `<div class="offline-bar" role="status">${UI.icon('wifi')}<span>You're offline — reconnect to load fresh data.</span></div>`;
  }

  function paint(route) {
    if (typeof LIAChat !== 'undefined') LIAChat.unmount();
    if (typeof MessagesWidget !== 'undefined') MessagesWidget.unmount();
    const app = document.getElementById('app');
    const bare = route.chrome === 'bare';
    app.dataset.screen = route.tab === 'emergency' ? 'emergency' : 'app';
    app.dataset.chrome = bare ? 'bare' : 'app';
    app.dataset.role = Auth.profile ? Auth.profile.role : '';
    app.innerHTML =
      offlineBar() +
      (bare ? '' : header(route)) +
      `<main class="main" id="main" tabindex="-1"></main>` +
      (bare ? '' : tabbar(route.tab));
    return document.getElementById('main');
  }

  /* ---------- render (serialised so a refresh never clobbers a running one) ---------- */
  let rendering = false;
  let queued = false;
  async function render() {
    if (rendering) { queued = true; return; }
    rendering = true;
    try { await doRender(); }
    catch (e) { console.error(e); }
    finally {
      rendering = false;
      if (queued) { queued = false; render(); }
    }
  }

  async function doRender() {
    const p = path();

    /* no Supabase keys yet */
    if (!API.ready) {
      if (typeof LIAChat !== 'undefined') LIAChat.clear();
      if (typeof MessagesWidget !== 'undefined') MessagesWidget.clear();
      const app = document.getElementById('app');
      app.dataset.chrome = 'bare';
      app.dataset.screen = 'app';
      app.innerHTML = `<main class="main setup" id="main">
        <h1>Connect your Supabase project</h1>
        <p class="lede">Add your project URL and anon key to <b>frontend/js/config.js</b>, then reload this page.</p>
        <code>const SUPABASE_URL='…'; const SUPABASE_KEY='…';</code>
      </main>`;
      return;
    }

    let hit = match(p) || match('/');

    /* auth guards */
    if (!Auth.session && hit.route.screen !== 'authScreen') { go('#/login'); return; }
    if (Auth.session && hit.route.screen === 'authScreen') { go('#/home'); return; }
    if (Auth.isHospital && ['/requests/new', '/emergency'].includes(p)) { go('#/hospital'); return; }
    if (Auth.isHospital && /^\/requests\/[^/]+$/.test(p)) { go('#/hospital'); return; }
    if (Auth.isDonor && p === '/requests/new') { go('#/requests'); return; }
    if (!Auth.isHospital && p === '/hospital') { go('#/requests'); return; }

    const main = paint(hit.route);
    if (lastPath !== p) {          /* move focus + scroll only on real navigation */
      lastPath = p;
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }

    /* profile still loading right after sign-in */
    if (Auth.session && !Auth.profile && !Auth.profileError) {
      main.innerHTML = `<div class="section"><div class="skeleton skeleton--card"></div></div>${UI.loading(2)}`;
      return;
    }
    if (Auth.profileError && hit.route.screen !== 'authScreen') {
      main.innerHTML = `<div class="section">${UI.errorBox(Auth.profileError)}</div>
        <div class="stack">
          <button class="btn btn--soft btn--block" data-act="retry-profile">Try again</button>
          <button class="btn btn--danger-ghost btn--block" data-act="signout">Log out</button>
        </div>`;
      return;
    }
    if (Auth.profile && Auth.profile.suspended_at) {
      LIAChat.clear();
      MessagesWidget.clear();
      main.innerHTML = `<section class="card section">
        <h1>Account suspended</h1>
        <p class="lede">Your account has been suspended by a hospital. You cannot create requests, volunteer or send messages while it is suspended.</p>
        ${Auth.profile.suspended_reason
          ? `<p class="small">${UI.esc(Auth.profile.suspended_reason)}</p>` : ''}
        <p class="small muted">Contact the hospital connected to your request or appointment for assistance.</p>
        <button class="btn btn--danger-ghost btn--block" data-act="signout">Log out</button>
      </section>`;
      return;
    }

    if (Auth.isDonor && !Auth.hasCurrentDonorConsent && p !== '/donor-consent') {
      go('#/donor-consent');
      return;
    }
    if (Auth.hasCurrentDonorConsent && p === '/donor-consent') {
      go('#/home');
      return;
    }

    if (Auth.session) startWatch(); else stopWatch();
    if (Auth.isHospital) refreshHospitalBadge();
    if (Auth.profile && (!Auth.isDonor || Auth.hasCurrentDonorConsent)) {
      LIAChat.mount();
      MessagesWidget.mount();
    } else {
      LIAChat.clear();
      MessagesWidget.clear();
    }

    const fn = window[hit.route.screen];
    if (typeof fn !== 'function') { go('#/home'); return; }
    try {
      await fn(main, hit.params);
    } catch (e) {
      console.error(e);
      main.innerHTML = UI.errorBox(UI.humanError(e), 'data-act="refresh"');
    }
  }

  /* ---------- realtime on requests ---------- */
  function startWatch() {
    if (liveOff || !API.ready) return;
    liveOff = API.watchRequests(payload => onRequestsEvent(payload));
  }
  function stopWatch() {
    if (liveOff) { liveOff(); liveOff = null; }
  }

  function onRequestsEvent(payload) {
    if (!Auth.profile || !payload || !payload.new) return;
    const row = payload.new;
    const me = Auth.profile;
    if (row.recipient_id !== me.id) return;

    if (row.event_type === 'hospital_incoming') {
      UI.toast(row.urgency === 'emergency'
        ? 'URGENT: New emergency request for your hospital.'
        : 'New request for your hospital.');
    } else if (row.event_type === 'hospital_volunteer') {
      UI.toast('A volunteer booked an appointment for a hospital call.');
    } else if (row.event_type === 'donor_call') {
      UI.toast(row.urgency === 'emergency'
        ? `Emergency call for voluntary donors: ${row.units} unit(s) of ${row.blood_type}.`
        : `New hospital call for voluntary donors: ${row.units} unit(s) of ${row.blood_type}.`);
    } else if (row.event_type === 'patient_approved') {
      UI.toast('The hospital approved your request and is calling voluntary donors.');
    } else if (row.event_type === 'patient_declined') {
      UI.toast('The hospital declined your request. Open it to choose another hospital.');
    } else if (row.event_type === 'patient_volunteer') {
      UI.toast('A volunteer booked an appointment. The hospital is coordinating next steps.');
    } else if (row.event_type === 'patient_volunteer_withdrawn') {
      UI.toast('A volunteer response changed. Message the hospital for an update.');
    } else if (row.event_type === 'patient_progress') {
      UI.toast(row.status === 'completed'
        ? 'The hospital marked the request completed.'
        : 'Your request progress has been updated.');
    } else if (row.event_type === 'donor_thank_you') {
      UI.toast('Thank you for your voluntary donation. The hospital recorded it.');
    }
    const p = path();
    if (p !== '/login' && p !== '/profile') render();
  }

  async function refreshHospitalBadge() {
    const badge = document.querySelector('[data-hospital-badge]');
    if (!badge || !Auth.isHospital) return;
    try {
      const rows = await API.requests.list();
      if (!badge.isConnected) return;
      const count = rows.filter(row => row.status === 'pending_hospital').length;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    } catch (e) {
      console.warn('Could not refresh incoming-request badge', e);
    }
  }

  /* ---------- global click delegation ---------- */
  function onClick(e) {
    const goEl = e.target.closest('[data-go]');
    if (goEl) { e.preventDefault(); go(goEl.dataset.go); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const name = act.dataset.act;
    if (name === 'refresh') { render(); }
    if (name === 'retry-profile') { Auth.loadProfile().then(render); }
    if (name === 'signout') { Auth.signOut(); }
  }

  async function start() {
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', render);
    window.addEventListener('online', () => render());
    window.addEventListener('offline', () => render());
    await Auth.start();
    render();
  }

  return { start, render, go, path, refresh: render };
})();
