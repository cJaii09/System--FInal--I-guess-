/* Shared UI helpers: DOM, icons, states, toasts, validation, formatting.
   Backend enums are mirrored here exactly as defined in backend/supabase. */

const UI = (() => {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* one icon style: 24x24 outline, currentColor */
  const PATHS = {
    home: '<path d="M3 10.6 12 3.4l9 7.2V20a1 1 0 0 1-1 1h-4.6v-6H8.6v6H4a1 1 0 0 1-1-1z"/>',
    list: '<rect x="4.5" y="4" width="15" height="17" rx="2"/><path d="M9 3h6v3H9zM8.5 11h7M8.5 15h5"/>',
    alert: '<path d="M12 3.6 2.8 19.4a1 1 0 0 0 .9 1.6h16.6a1 1 0 0 0 .9-1.6z"/><path d="M12 9.5v4.2M12 17.2h.01"/>',
    user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20.4a7.4 7.4 0 0 1 14.4 0"/>',
    drop: '<path d="M12 3.2s6 6.4 6 10.4a6 6 0 0 1-12 0c0-4 6-10.4 6-10.4z"/>',
    phone: '<path d="M6.2 3.6h3l1.5 3.7-2 1.3a12.4 12.4 0 0 0 5.7 5.7l1.3-2 3.7 1.5v3a1.8 1.8 0 0 1-2 1.8A15.6 15.6 0 0 1 4.4 5.6a1.8 1.8 0 0 1 1.8-2z"/>',
    pin: '<path d="M19 10.4c0 5.2-7 11-7 11s-7-5.8-7-11a7 7 0 1 1 14 0z"/><circle cx="12" cy="10.2" r="2.6"/>',
    chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    back: '<path d="M19.5 12H4.5M11 5.5 4.5 12 11 18.5"/>',
    check: '<path d="m4.8 12.6 4.8 4.8L19.4 7.4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    refresh: '<path d="M20.4 12a8.4 8.4 0 1 1-2.5-6"/><path d="M20.6 4.4v5.2h-5.2"/>',
    share: '<path d="M12 15.5V3.6M12 3.6 8.2 7.4M12 3.6l3.8 3.8"/><path d="M5 13.6V19a1.6 1.6 0 0 0 1.6 1.6h10.8A1.6 1.6 0 0 0 19 19v-5.4"/>',
    logout: '<path d="M15.6 16.4 20 12l-4.4-4.4M20 12H9.4"/><path d="M12 3.6H6.4A1.8 1.8 0 0 0 4.6 5.4v13.2a1.8 1.8 0 0 0 1.8 1.8H12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v4.6M12 8.4h.01"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
    building: '<path d="M4 20.6V6.2L12 3l8 3.2v14.4"/><path d="M9.6 20.6V15.4h4.8v5.2M9 9.6h1.6M13.4 9.6H15M9 12.8h1.6M13.4 12.8H15"/>',
    wifi: '<path d="M3 8.6a14 14 0 0 1 18 0M6.4 12.4a9 9 0 0 1 11.2 0M9.8 16.2a4 4 0 0 1 4.4 0M12 19.6h.01"/>',
    inbox: '<path d="M4 13.4h4l1.6 2.6h4.8l1.6-2.6h4"/><path d="M6.2 4.6h11.6l2.2 8.8v4.4a1.8 1.8 0 0 1-1.8 1.8H5.8a1.8 1.8 0 0 1-1.8-1.8v-4.4z"/>',
    file: '<path d="M13.6 3.6H7.4a1.8 1.8 0 0 0-1.8 1.8v13.2a1.8 1.8 0 0 0 1.8 1.8h9.2a1.8 1.8 0 0 0 1.8-1.8V8.4z"/><path d="M13.6 3.6v4.8H18.4M8.8 13h6.4M8.8 16.4h4.6"/>',
    shield: '<path d="M12 3.2 5 5.8v5.4c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V5.8z"/><path d="m9.2 12 2 2 3.6-3.6"/>',
    medical: '<path d="M9.4 3.6h5.2v5.8h5.8v5.2h-5.8v5.8H9.4v-5.8H3.6V9.4h5.8z"/>',
    sparkle: '<path d="M12 4.2s4.5 4.8 4.5 8a4.5 4.5 0 0 1-9 0c0-3.2 4.5-8 4.5-8z"/><path d="m19 3 .7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7z"/>',
    message: '<path d="M4.2 5.2h15.6a1.8 1.8 0 0 1 1.8 1.8v9a1.8 1.8 0 0 1-1.8 1.8H9l-5.2 3v-3.2A1.8 1.8 0 0 1 2 15.8V7a1.8 1.8 0 0 1 2.2-1.8z"/><path d="M6.5 9.5h11M6.5 13h7"/>'
  };

  function icon(name, cls) {
    const p = PATHS[name] || PATHS.info;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${p}</svg>`;
  }

  /* ---------- states ---------- */
  function loading(rows = 3) {
    let out = '<div class="section" aria-hidden="true">';
    for (let i = 0; i < rows; i++) out += '<div class="skeleton skeleton--row"></div>';
    return out + '</div><p class="small muted center" role="status">Loading…</p>';
  }

  function empty(title, text, actionHtml) {
    return `<div class="state"><div class="state__icon">${icon('inbox')}</div>
      <div class="state__title">${esc(title)}</div>
      ${text ? `<p class="state__text">${esc(text)}</p>` : ''}
      ${actionHtml || ''}</div>`;
  }

  function errorBox(message, retryAttr = '') {
    return `<div class="notice notice--error" role="alert">${icon('info')}<span>${esc(message)}</span></div>
      ${retryAttr ? `<button class="btn btn--soft btn--block" ${retryAttr}>Try again</button>` : ''}`;
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(message, kind = 'ok') {
    const el = $('#toast');
    if (!el) return;
    el.className = 'toast toast--' + (kind === 'bad' ? 'bad' : 'ok');
    el.innerHTML = icon(kind === 'bad' ? 'info' : 'check') + '<span>' + esc(message) + '</span>';
    requestAnimationFrame(() => el.classList.add('is-on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
  }

  /* ---------- errors: never show raw messages ---------- */
  function humanError(err) {
    if (!navigator.onLine) return "You're offline. Check your connection and try again.";
    const m = String((err && (err.message || err.error_description || err.error)) || '');
    const code = String((err && err.code) || '');
    if (/Failed to fetch|NetworkError|Network request failed|Load failed/i.test(m))
      return "Can't reach the server. Check your connection and try again.";
    if (/row-level security|permission denied|42501/i.test(m + code))
      return "You don't have permission to do that.";
    if (code === 'InvalidLoginCredentials' || /Invalid login credentials/i.test(m))
      return 'Wrong email or password.';
    if (/Email not confirmed/i.test(m))
      return 'Confirm your email first — open the link we sent you.';
    if (/already registered|already been register|User already/i.test(m))
      return 'That email is already registered. Try logging in instead.';
    if (/at least 6|weak password|password should/i.test(m))
      return 'Use at least 8 characters for your password.';
    if (/rate limit|too many (requests|calls)|429/i.test(m))
      return 'Too many attempts. Wait a moment and try again.';
    if (/23514|violates check constraint/i.test(m + code))
      return 'One of the values you chose is not allowed.';
    if (/23503|foreign key/i.test(m + code))
      return 'That record is no longer available.';
    if (/23505|duplicate key/i.test(m + code))
      return 'That already exists.';
    if (/JWT|token|expired/i.test(m))
      return 'Your session has expired. Please log in again.';
    if (/row not found|results were empty|No rows/i.test(m))
      return 'That item is no longer available.';
    return 'Something went wrong. Please try again.';
  }

  /* ---------- formatting ---------- */
  function timeAgo(iso) {
    if (!iso) return '';
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function distanceKm(a, b, c, d) {
    const r = x => (x * Math.PI) / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 +
      Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  function distanceLabel(from, to) {
    if (!from || !to || to[0] == null || to[1] == null) return '';
    const km = distanceKm(from[0], from[1], to[0], to[1]);
    return km < 10 ? km.toFixed(1) + ' km away' : Math.round(km) + ' km away';
  }

  function coordsLink(lat, lng) {
    if (lat == null || lng == null) return '';
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] ? w[0].toUpperCase() : '').join('') || '?';

  /* ---------- validation ---------- */
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isStrong = v => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(v);

  function fieldError(input, message) {
    if (!input) return;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    const field = input.closest('.field');
    if (!field) return;
    let err = field.querySelector('.field-error');
    if (message) {
      if (!err) {
        err = document.createElement('p');
        err.className = 'field-error';
        err.id = (input.id || 'f') + '-err';
        field.appendChild(err);
      }
      err.innerHTML = icon('info') + '<span>' + esc(message) + '</span>';
      input.setAttribute('aria-describedby', err.id);
    } else if (err) {
      err.remove();
      input.removeAttribute('aria-describedby');
    }
  }

  function clearErrors(root) {
    $$('.field-error', root).forEach(e => e.remove());
    $$('[aria-invalid]', root).forEach(e => e.setAttribute('aria-invalid', 'false'));
  }

  /* busy state for a submit button */
  function busy(btn, label) {
    if (!btn) return () => {};
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.dataset.busy = '1';
    btn.innerHTML = esc(label || 'Working…');
    return () => {
      btn.disabled = false;
      delete btn.dataset.busy;
      btn.innerHTML = html;
    };
  }

  return {
    $, $$, esc, icon, loading, empty, errorBox, toast, humanError,
    timeAgo, distanceLabel, distanceKm, coordsLink, initials,
    isEmail, isStrong, fieldError, clearErrors, busy
  };
})();

/* Backend enums the UI actually uses (backend/supabase/001_tables.sql) */
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const URGENCIES = ['normal', 'urgent', 'emergency'];
