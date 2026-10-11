/* Session state: keeps the Supabase session alive across reloads, loads the
   profile row created by the on_signup trigger, and exposes auth actions. */

const Auth = {
  session: null,
  profile: null,
  profileError: null,

  get user() { return this.session ? this.session.user : null; },
  get id() { return this.user ? this.user.id : null; },
  get emailConfirmed() { return !!(this.user && this.user.email_confirmed_at); },
  get isDonor() { return !!this.profile && this.profile.role === 'donor'; },
  get isHospital() { return !!this.profile && this.profile.role === 'hospital'; },
  get hasCurrentDonorConsent() {
    return this.isDonor && !!this.profile.consent_at &&
      this.profile.consent_version === API.donorConsentVersion;
  },

  async start() {
    if (!API.ready) return;                       // keys not set yet
    try {
      const { data } = await API.auth.getSession();
      this.session = data.session;
      if (this.session) await this.loadProfile();
    } catch (e) {
      this.profileError = UI.humanError(e);
    }
    API.auth.onAuthChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      this.session = session;
      this.handleAuthChange(event);
    });
  },

  async demoLogin(email, password) {
    const res = await API.auth.signIn(email, password);
    this.session = res.session;
    await this.loadProfile();
    return res;
  },

  async handleAuthChange(event) {
    if (event === 'SIGNED_OUT' || !this.session) {
      this.profile = null;
      this.profileError = null;
      Router.render();
      return;
    }
    await this.loadProfile();
    Router.render();
  },

  async loadProfile() {
    this.profileError = null;
    try {
      this.profile = await API.profiles.get(this.id);
      if (!this.profile) this.profileError = 'We could not load your profile.';
    } catch (e) {
      this.profile = null;
      this.profileError = UI.humanError(e);
    }
  },

  async signIn(email, password) {
    const res = await API.auth.signIn(email, password);
    this.session = res.session;
    await this.loadProfile();
    return res;
  },

  /* metadata keys must match handle_new_user(): role, full_name, address, phone, blood_type */
  async signUp(fields) {
    const res = await API.auth.signUp(fields);
    this.session = res.session;
    if (res.session) await this.loadProfile();
    return res;
  },

  async signOut() {
    try { await API.auth.signOut(); } catch (e) { console.warn(e); }
    this.session = null;
    this.profile = null;
    Router.go('#/login');
    Router.render();
  },

  async saveProfile(patch) {
    const updated = await API.profiles.update(this.id, patch);
    if (updated) this.profile = Object.assign({}, this.profile, updated);
    return updated;
  },

  async acceptDonorConsent() {
    const accepted = await API.profiles.acceptDonorConsent(API.donorConsentVersion);
    this.profile = Object.assign({}, this.profile, accepted);
    return accepted;
  },
};
