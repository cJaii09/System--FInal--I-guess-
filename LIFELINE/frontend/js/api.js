/* The only file that talks to Supabase. Screens never call the client directly.

   Backend objects used here (backend/supabase):
     tables   : profiles, requests, hospitals, request_events
     views    : role-scoped request views and hospital volunteer registry
     policies : see backend/supabase/migrations — role-specific data is enforced
                by database grants, views and row-level security. */

const API = (() => {
  const placeholderUrl = 'https://your-project.supabase.co';
  const placeholderKey = 'your-anon-public-key';
  const DONOR_CONSENT_VERSION = '2026-10-v1';
  const DAYS_56_MS = 56 * 86400000;

  function utcDay(value) {
    const date = new Date(value);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function within56Days(value) {
    if (!value) return false;
    const today = utcDay(new Date());
    return utcDay(value) > today - DAYS_56_MS;
  }

  const configMissing = typeof SUPABASE_URL !== 'string' ||
    !SUPABASE_URL.trim() ||
    SUPABASE_URL === placeholderUrl ||
    typeof SUPABASE_KEY !== 'string' ||
    !SUPABASE_KEY.trim() ||
    SUPABASE_KEY === placeholderKey;

  let sb = null;
  if (!configMissing) {
    try { sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
    catch (e) { console.error('Supabase client failed to start', e); }
  }

  const DEMO_HOSPITALS = [
    { id: 'hospital-knh', name: 'Kenyatta National Hospital', address: 'Hospital Road, Upper Hill, Nairobi', phone: '+254 20 2726300', lat: -1.3008, lng: 36.8069, is_approved: true, is_active: true },
    { id: 'hospital-mp-shah', name: 'MP Shah Hospital', address: 'Shivachi Road, Parklands, Nairobi', phone: '+254 20 4291000', lat: -1.2635, lng: 36.8147, is_approved: true, is_active: true },
    { id: 'hospital-agakhan', name: 'Aga Khan University Hospital', address: '3rd Parklands Avenue, Nairobi', phone: '+254 20 3662000', lat: -1.2571, lng: 36.8154, is_approved: true, is_active: true },
    { id: 'hospital-nairobi', name: 'The Nairobi Hospital', address: 'Argwings Kodhek Road, Nairobi', phone: '+254 703 082000', lat: -1.2988, lng: 36.8031, is_approved: true, is_active: true },
    { id: 'hospital-test', name: 'Demo Unapproved Hospital', address: 'Nairobi', phone: null, lat: null, lng: null, is_approved: false, is_active: true }
  ];

  const DEMO_USERS = [
    { id: 'demo-patient', email: 'patient@demo.com', password: 'Demo123!', role: 'patient', full_name: 'Amina Rahman', blood_type: 'O-', phone: '+1 555 010 2030', address: 'Downtown, Nairobi', donor_status: 'active', donations: 0, reliability: 92, verified: true, lat: -1.286389, lng: 36.817223 },
    { id: 'demo-hospital', email: 'hospital@demo.com', password: 'Demo123!', role: 'hospital', hospital_id: 'hospital-mp-shah', full_name: 'MP Shah Hospital', phone: '+254 20 4291000' },
    { id: 'demo-donor', email: 'donor@demo.com', password: 'Demo123!', role: 'donor', full_name: 'Daniel Okafor', blood_type: 'A+', phone: '+1 555 010 3030', address: 'Westlands, Nairobi', donor_status: 'active', donations: 18, reliability: 96, verified: true, lat: -1.262519, lng: 36.809312, consent_at: null, consent_version: null, last_donated_at: null },
    { id: 'demo-patient-2', email: 'mary@demo.com', password: 'Demo123!', role: 'patient', full_name: 'Mary Wanjiku', blood_type: 'A+', phone: '+1 555 010 8080', address: 'South B, Nairobi', donations: 0, reliability: 84, verified: true, lat: -1.313, lng: 36.821 }
  ];

  const DEMO_PROFILES = [
    ...DEMO_USERS,
    { id: 'demo-donor-2', email: 'grace@demo.com', role: 'donor', full_name: 'Grace Mwangi', blood_type: 'O+', phone: '+1 555 010 5050', address: 'Kilimani, Nairobi', donor_status: 'active', donations: 7, reliability: 91, verified: true, lat: -1.286, lng: 36.783 },
    { id: 'demo-donor-3', email: 'lucas@demo.com', role: 'donor', full_name: 'Lucas Njeri', blood_type: 'AB+', phone: '+1 555 010 6060', address: 'Runda, Nairobi', donor_status: 'active', donations: 11, reliability: 94, verified: true, lat: -1.242, lng: 36.746 },
    { id: 'demo-donor-4', email: 'nina@demo.com', role: 'donor', full_name: 'Nina Mbithe', blood_type: 'A-', phone: '+1 555 010 7070', address: 'Muthaiga, Nairobi', donor_status: 'active', donations: 6, reliability: 89, verified: true, lat: -1.246, lng: 36.809 },
  ];

  const DEMO_REQUESTS = [
    { id: 'req-demo-1', patient_id: 'demo-patient', donor_id: null, status: 'pending', blood_type: 'O-', units: 2, urgency: 'emergency', hospital_id: 'hospital-knh', hospital_info: DEMO_HOSPITALS[0], hospital_note: null, created_at: '2026-10-06T08:15:00Z', patient: { id: 'demo-patient', full_name: 'Amina Rahman', phone: '+1 555 010 2030', blood_type: 'O-', verified: true, donor_status: 'active', donations: 0, reliability: 92 }, donor: null, declined_by: [] },
    { id: 'req-demo-3', patient_id: 'demo-patient-2', donor_id: null, status: 'pending_hospital', blood_type: 'A+', units: 1, urgency: 'normal', hospital_id: 'hospital-mp-shah', hospital_info: DEMO_HOSPITALS[1], hospital_note: null, created_at: '2026-10-04T13:30:00Z', patient: { id: 'demo-patient-2', full_name: 'Mary Wanjiku', phone: '+1 555 010 8080', blood_type: 'A+', verified: true, donor_status: 'active', donations: 0, reliability: 84 }, donor: null, declined_by: [] },
    { id: 'req-demo-donor-thread', patient_id: 'demo-patient-2', donor_id: null, status: 'pending', blood_type: 'A+', units: 1, units_confirmed: 0, urgency: 'urgent', hospital_id: 'hospital-mp-shah', hospital_info: DEMO_HOSPITALS[1], hospital_note: null, created_at: '2026-10-05T10:00:00Z', patient: { id: 'demo-patient-2', full_name: 'Mary Wanjiku', phone: '+1 555 010 8080', blood_type: 'A+', verified: true, donor_status: 'active', donations: 0, reliability: 84 }, donor: null, declined_by: [] },
    { id: 'req-demo-call', patient_id: 'demo-patient-2', donor_id: null, status: 'pending', blood_type: 'A+', units: 1, urgency: 'urgent', hospital_id: 'hospital-mp-shah', hospital_info: DEMO_HOSPITALS[1], hospital_note: null, created_at: '2026-10-07T09:00:00Z', patient: { id: 'demo-patient-2', full_name: 'Mary Wanjiku', phone: '+1 555 010 8080', blood_type: 'A+', verified: true, donor_status: 'active', donations: 0, reliability: 84 }, donor: null, declined_by: [] }
  ];
  const DEMO_APPOINTMENTS = [{
    id: 'appointment-demo-donor',
    request_id: 'req-demo-donor-thread',
    donor_id: 'demo-donor',
    hospital_id: 'hospital-mp-shah',
    slot_start: (() => {
      const slot = new Date(Date.now() + 86400000);
      slot.setSeconds(0, 0);
      slot.setMinutes(Math.ceil(slot.getMinutes() / 30) * 30);
      return slot.toISOString();
    })(),
    status: 'scheduled',
    hospital_note: null,
    donor_cancel_reason: null,
    created_at: new Date().toISOString()
  }];
  const DEMO_WINDOWS = [{
    request_id: 'req-demo-call',
    hospital_id: 'hospital-mp-shah',
    window_start: new Date(Date.now() + 3600000).toISOString(),
    window_end: new Date(Date.now() + 6 * 3600000).toISOString(),
    slot_minutes: 30
  }, {
    request_id: 'req-demo-donor-thread',
    hospital_id: 'hospital-mp-shah',
    window_start: new Date(new Date(Date.now() + 86400000).setSeconds(0, 0) -
      (new Date(Date.now() + 86400000).getMinutes() % 30) * 60000 - 30 * 60000).toISOString(),
    window_end: new Date(Date.now() + 30 * 3600000).toISOString(),
    slot_minutes: 30
  }];
  let demoRequestSequence = 0;
  const demoRequestListeners = new Set();

  const DEMO_THREADS = [
    { id: 'thread-demo-patient', request_id: 'req-demo-3', hospital_id: 'hospital-mp-shah', thread_type: 'patient_hospital', participant_id: 'demo-patient-2', created_at: '2026-10-04T13:31:00Z' },
    { id: 'thread-demo-patient-call', request_id: 'req-demo-call', hospital_id: 'hospital-mp-shah', thread_type: 'patient_hospital', participant_id: 'demo-patient-2', created_at: '2026-10-07T09:01:00Z' },
    { id: 'thread-demo-donor', request_id: 'req-demo-donor-thread', hospital_id: 'hospital-mp-shah', thread_type: 'donor_hospital', participant_id: 'demo-donor', created_at: '2026-10-05T10:01:00Z' }
  ];
  const DEMO_MESSAGES = [
    { id: 'message-demo-1', thread_id: 'thread-demo-patient', sender_id: 'demo-patient-2', body: 'Hello, could you let me know if my request is being reviewed?', created_at: '2026-10-04T13:32:00Z', read_at: null },
    { id: 'message-demo-2', thread_id: 'thread-demo-patient', sender_id: 'demo-hospital', body: 'We have received your request and will review it shortly.', created_at: '2026-10-04T13:35:00Z', read_at: null },
    { id: 'message-demo-3', thread_id: 'thread-demo-donor', sender_id: 'demo-donor', body: 'I booked an appointment. Please let me know where to report.', created_at: '2026-10-05T10:02:00Z', read_at: null }
  ];
  const demoMessageListeners = new Set();
  const messageSendTimes = new Map();
  let demoMessageSequence = 0;
  const DEMO_REPORTS = [];
  const DEMO_PRECHECKS = [];

  function demoCanSeeThread(thread, user) {
    if (!user || !thread) return false;
    if (user.role === 'hospital') return thread.hospital_id === user.hospital_id;
    if (user.role === 'patient') {
      const request = DEMO_REQUESTS.find(row => row.id === thread.request_id);
      return thread.thread_type === 'patient_hospital' && thread.participant_id === user.id &&
        request && request.patient_id === user.id;
    }
    const request = DEMO_REQUESTS.find(row => row.id === thread.request_id);
    return thread.thread_type === 'donor_hospital' && thread.participant_id === user.id &&
      DEMO_APPOINTMENTS.some(appointment => appointment.request_id === thread.request_id &&
        appointment.donor_id === user.id &&
        ['scheduled', 'donated', 'deferred', 'no_show'].includes(appointment.status));
  }

  function ensureDemoThread(request, threadType, participantId) {
    const existing = DEMO_THREADS.find(thread =>
      thread.request_id === request.id && thread.thread_type === threadType &&
      thread.participant_id === participantId);
    if (existing) return existing;
    const thread = {
      id: `thread-demo-${Date.now()}-${++demoMessageSequence}`,
      request_id: request.id,
      hospital_id: request.hospital_id,
      thread_type: threadType,
      participant_id: participantId,
      created_at: new Date().toISOString()
    };
    DEMO_THREADS.unshift(thread);
    return thread;
  }

  function demoThreadDetails(thread, user) {
    const request = DEMO_REQUESTS.find(row => row.id === thread.request_id);
    const hospital = DEMO_HOSPITALS.find(row => row.id === thread.hospital_id);
    const counterpart = user.role === 'hospital'
      ? (thread.thread_type === 'patient_hospital' ? 'Patient' : 'Donor')
      : (hospital ? hospital.name : 'Hospital');
    const threadMessages = DEMO_MESSAGES.filter(message => message.thread_id === thread.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = threadMessages[threadMessages.length - 1] || null;
    return {
      ...thread,
      counterpart,
      request: request ? {
        id: request.id, blood_type: request.blood_type, urgency: request.urgency, status: request.status
      } : null,
      last_message: last ? {
        body: last.body, sender_id: last.sender_id, created_at: last.created_at
      } : null,
      unread_count: threadMessages.filter(message => message.sender_id !== user.id && !message.read_at).length
    };
  }

  function currentDemoSession() {
    try {
      const raw = localStorage.getItem('lifeline-demo-session');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function demoModeEnabled() {
    return !!currentDemoSession();
  }

  function demoUserByEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    return DEMO_USERS.find(u => u.email.toLowerCase() === value) || null;
  }

  function demoUserById(id) {
    return DEMO_PROFILES.find(u => u.id === id) || null;
  }

  function demoPatientRequest(request) {
    const hospital = DEMO_HOSPITALS.find(row => row.id === request.hospital_id);
    const volunteerCount = DEMO_APPOINTMENTS.filter(appointment =>
      appointment.request_id === request.id && ['scheduled', 'donated'].includes(appointment.status)).length;
    return {
      id: request.id,
      blood_type: request.blood_type,
      units: request.units,
      units_confirmed: request.units_confirmed || 0,
      urgency: request.urgency,
      status: request.status,
      created_at: request.created_at,
      hospital_id: request.hospital_id,
      hospital_name: hospital ? hospital.name : '',
      hospital_address: hospital ? hospital.address : '',
      hospital_note: request.hospital_note,
      hospital_decision_at: request.hospital_decision_at,
      volunteer_count: volunteerCount
    };
  }

  function demoDonorCall(request) {
    const hospital = DEMO_HOSPITALS.find(row => row.id === request.hospital_id);
    const volunteerCount = DEMO_APPOINTMENTS.filter(appointment =>
      appointment.request_id === request.id && ['scheduled', 'donated'].includes(appointment.status)).length;
    return {
      id: request.id,
      blood_type: request.blood_type,
      units: request.units,
      units_confirmed: request.units_confirmed || 0,
      volunteer_count: volunteerCount,
      urgency: request.urgency,
      status: request.status,
      created_at: request.created_at,
      hospital_id: request.hospital_id,
      hospital_name: hospital ? hospital.name : '',
      hospital_address: hospital ? hospital.address : ''
    };
  }

  function emitDemoRequestEvent(eventType, request, recipientId) {
    if (!request || !recipientId) return;
    const payload = {
      eventType: 'INSERT',
      new: {
        recipient_id: recipientId,
        event_type: eventType,
        request_id: request.id,
        status: request.status,
        blood_type: request.blood_type,
        units: request.units,
        urgency: request.urgency,
        hospital_id: request.hospital_id,
        hospital_note: eventType === 'patient_declined' ? request.hospital_note : null
      },
      old: {}
    };
    demoRequestListeners.forEach(listener => listener(payload));
  }

  function demoCurrentUser() {
    const session = currentDemoSession();
    if (!session || !session.user) return null;
    return demoUserById(session.user.id) || DEMO_USERS.find(u => u.email === session.user.email) || null;
  }

  function demoResult(user) {
    return {
      session: {
        access_token: 'demo-access-token',
        refresh_token: 'demo-refresh-token',
        expires_at: Date.now() + 3600000,
        expires_in: 3600,
        token_type: 'demo',
        user: {
          id: user.id,
          email: user.email,
          app_metadata: { provider: 'demo' },
          user_metadata: { role: user.role, full_name: user.full_name, blood_type: user.blood_type },
          created_at: '2024-01-01T00:00:00Z',
          email_confirmed_at: '2024-01-01T00:00:00Z'
        }
      },
      user: {
        id: user.id,
        email: user.email,
        app_metadata: { provider: 'demo' },
        user_metadata: { role: user.role, full_name: user.full_name, blood_type: user.blood_type },
        created_at: '2024-01-01T00:00:00Z',
        email_confirmed_at: '2024-01-01T00:00:00Z'
      }
    };
  }

  /* every query funnels through here so errors come back as readable messages */
  async function run(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  async function runTimedQuery(query, label, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(query.abortSignal(controller.signal));
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${label} timed out. Check your connection and try again.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ---------------- auth ---------------- */
  const auth = {
    getSession: () => {
      const demo = currentDemoSession();
      if (demo) return Promise.resolve({ data: { session: demo.session || demo } });
      if (!sb) return Promise.resolve({ data: { session: null } });
      return sb.auth.getSession();
    },
    onAuthChange: cb => {
      const demo = currentDemoSession();
      if (demo) {
        cb('INITIAL_SESSION', demo.session || demo);
        return () => {};
      }
      if (!sb) return () => {};
      return sb.auth.onAuthStateChange(cb);
    },
    async signIn(email, password) {
      const user = demoUserByEmail(email);
      if (user && user.password === password) {
        const result = demoResult(user);
        localStorage.setItem('lifeline-demo-session', JSON.stringify({
          user: { id: user.id, email: user.email, role: user.role },
          session: result.session
        }));
        return result;
      }
      if (!sb) throw new Error('Use one of the demo accounts on the login screen.');
      return run(sb.auth.signInWithPassword({ email, password }));
    },
    async signUp({
      email, password, role, full_name, address, phone, blood_type,
      donor_consent_accepted, donor_consent_version
    }) {
      if (demoModeEnabled()) {
        const user = demoUserByEmail(email);
        if (user) return demoResult(user);
        throw new Error('Demo mode is active. Use the demo accounts on the login page.');
      }
      if (!sb) {
        throw new Error('Use one of the demo accounts on the login screen.');
      }
      return run(sb.auth.signUp({
        email, password,
        options: { data: {
          role, full_name, address, phone, blood_type: blood_type || null,
          donor_consent_accepted: role === 'donor' && donor_consent_accepted === true,
          donor_consent_version: role === 'donor' ? donor_consent_version : null
        } }
      }));
    },
    signOut: () => {
      const wasDemo = demoModeEnabled();
      localStorage.removeItem('lifeline-demo-session');
      if (wasDemo) return Promise.resolve({ error: null });
      if (!sb) return Promise.resolve({ error: null });
      return sb.auth.signOut();
    },
    updatePassword: p => {
      if (!sb) return Promise.resolve({ data: { user: demoCurrentUser() }, error: null });
      return run(sb.auth.updateUser({ password: p }));
    },
    updateEmail: e => {
      if (!sb) return Promise.resolve({ data: { user: demoCurrentUser() }, error: null });
      return run(sb.auth.updateUser({ email: e }));
    }
  };

  /* ---------------- profiles ---------------- */
  const profiles = {
    async get(id) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        return user && user.id === id ? user : null;
      }
      if (!sb) return null;
      const data = await run(sb.from('profiles')
        .select('id,role,hospital_id,full_name,phone,address,blood_type,donor_status,consent_at,consent_version,last_donated_at,suspended_at,suspended_reason')
        .eq('id', id).maybeSingle());
      return data;
    },
    async update(id, patch) {
      const clean = {};
      const allowedFields = new Set(['full_name', 'phone', 'address', 'blood_type', 'donor_status']);
      const unsupportedField = Object.keys(patch).find(key => !allowedFields.has(key));
      if (unsupportedField) throw new Error('Some profile fields cannot be changed.');
      Object.keys(patch).forEach(key => {
        if (patch[key] !== undefined && allowedFields.has(key)) clean[key] = patch[key];
      });
      if (demoModeEnabled()) {
        const demo = demoCurrentUser();
        if (!demo || demo.id !== id) return null;
        const updated = { ...demo, ...clean };
        const idx = DEMO_PROFILES.findIndex(p => p.id === id);
        if (idx >= 0) DEMO_PROFILES[idx] = updated;
        return updated;
      }
      if (!sb) return null;
      const data = await run(sb.from('profiles').update(clean).eq('id', id)
        .select('id,full_name,phone,address,blood_type,donor_status').maybeSingle());
      return data;
    },
    async acceptDonorConsent(version) {
      if (version !== DONOR_CONSENT_VERSION) throw new Error('Please review the current donor consent statement.');
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user || user.role !== 'donor') throw new Error('Only donors can accept this statement.');
        const accepted = {
          ...user,
          consent_at: new Date().toISOString(),
          consent_version: version
        };
        const index = DEMO_PROFILES.findIndex(profile => profile.id === user.id);
        if (index >= 0) DEMO_PROFILES[index] = accepted;
        return accepted;
      }
      if (!sb) throw new Error('Donor consent could not be recorded. Please try again.');
      const acceptedAt = await run(sb.rpc('lifeline_accept_donor_consent', { p_version: version }));
      return { consent_at: acceptedAt, consent_version: version };
    },
    async suspend(profileId, reason) {
      const cleanReason = String(reason || '').trim();
      if (cleanReason.length < 3 || cleanReason.length > 500) {
        throw new Error('Enter a short suspension reason (3 to 500 characters).');
      }
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const target = DEMO_PROFILES.find(profile => profile.id === profileId);
        const connected = user && user.role === 'hospital' && target &&
          (target.role === 'patient'
            ? DEMO_REQUESTS.some(request => request.patient_id === profileId &&
              request.hospital_id === user.hospital_id)
            : target.role === 'donor' && DEMO_APPOINTMENTS.some(appointment =>
              appointment.donor_id === profileId && appointment.hospital_id === user.hospital_id));
        if (!connected) throw new Error('This account is not connected to your hospital.');
        target.suspended_at = target.suspended_at || new Date().toISOString();
        target.suspended_reason = cleanReason;
        return target.suspended_at;
      }
      return run(sb.rpc('lifeline_suspend_connected_account', {
        p_profile_id: profileId,
        p_reason: cleanReason
      }));
    }
  };

  const hospitals = {
    async list() {
      if (demoModeEnabled()) return DEMO_HOSPITALS.filter(h => h.is_approved && h.is_active);
      return run(sb.from('hospitals').select('id,name,address,phone,lat,lng,is_approved,is_active')
        .eq('is_approved', true).eq('is_active', true).order('name'));
    }
  };

  const appointments = {
    async getWindow(requestId) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const request = DEMO_REQUESTS.find(row => row.id === requestId);
        if (!user || !request || (user.role === 'hospital'
          ? user.hospital_id !== request.hospital_id
          : user.role !== 'donor' || user.donor_status !== 'active' ||
            user.blood_type !== request.blood_type || request.status !== 'pending' ||
            DEMO_APPOINTMENTS.filter(appointment =>
              appointment.request_id === requestId && ['scheduled', 'donated'].includes(appointment.status)).length >= request.units)) return null;
        const window = DEMO_WINDOWS.find(row => row.request_id === requestId);
        return window ? { ...window } : null;
      }
      return run(sb.from('donor_call_windows').select('*')
        .eq('request_id', requestId).maybeSingle());
    },
    async setWindow(requestId, windowStart, windowEnd, slotMinutes) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const request = DEMO_REQUESTS.find(row => row.id === requestId &&
          user && user.role === 'hospital' && row.hospital_id === user.hospital_id &&
          row.status === 'pending');
        const start = new Date(windowStart);
        const end = new Date(windowEnd);
        if (!request || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
            start <= new Date() || end <= start || end - start > 14 * 86400000 ||
            ![30, 60].includes(Number(slotMinutes)) ||
            end - start < Number(slotMinutes) * 60000) {
          throw new Error('Choose a future time window within 14 days and a 30- or 60-minute slot length.');
        }
        const booked = DEMO_APPOINTMENTS.filter(row => row.request_id === requestId &&
          row.status === 'scheduled');
        if (booked.some(row => {
          const slot = new Date(row.slot_start);
          return slot < start || slot.getTime() + Number(slotMinutes) * 60000 > end ||
            (slot - start) % (Number(slotMinutes) * 60000) !== 0;
        })) throw new Error('The updated window must keep all already-booked appointment times.');
        const saved = {
          request_id: requestId, hospital_id: request.hospital_id,
          window_start: start.toISOString(), window_end: end.toISOString(),
          slot_minutes: Number(slotMinutes), updated_at: new Date().toISOString()
        };
        const index = DEMO_WINDOWS.findIndex(row => row.request_id === requestId);
        if (index >= 0) DEMO_WINDOWS[index] = saved;
        else DEMO_WINDOWS.push(saved);
        return saved;
      }
      return run(sb.rpc('lifeline_save_donor_call_window', {
        p_request_id: requestId,
        p_window_start: windowStart,
        p_window_end: windowEnd,
        p_slot_minutes: Number(slotMinutes)
      }));
    },
    async book(requestId, slotStart) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const donor = user && DEMO_PROFILES.find(row => row.id === user.id);
        const request = DEMO_REQUESTS.find(row => row.id === requestId && row.status === 'pending' &&
          user && user.role === 'donor' && row.blood_type === user.blood_type);
        const window = DEMO_WINDOWS.find(row => row.request_id === requestId);
        const slot = new Date(slotStart);
        const activeCount = DEMO_APPOINTMENTS.filter(row => row.request_id === requestId &&
          row.status === 'scheduled').length;
        const precheck = DEMO_PRECHECKS.find(row => row.request_id === requestId &&
          row.donor_id === user.id && row.result === 'Pre-check passed');
        if (!donor || !donor.consent_at || donor.consent_version !== DONOR_CONSENT_VERSION) {
          throw new Error('Review and accept the donor consent statement before booking.');
        }
        if (within56Days(donor.last_donated_at)) {
          const eligibleDate = new Date(utcDay(donor.last_donated_at) + DAYS_56_MS);
          throw new Error(`You can volunteer again on ${eligibleDate.toLocaleDateString()}.`);
        }
        if (!request || !precheck) throw new Error('Complete a passing pre-check before booking. The hospital makes the final medical decision.');
        if (!window || !Number.isFinite(slot.getTime()) || slot < new Date() ||
            slot < new Date(window.window_start) ||
            slot.getTime() + window.slot_minutes * 60000 > new Date(window.window_end).getTime() ||
            (slot - new Date(window.window_start)) % (window.slot_minutes * 60000) !== 0) {
          throw new Error('Choose one of the appointment times provided by the hospital.');
        }
        if (DEMO_APPOINTMENTS.some(row => row.request_id === requestId &&
            row.donor_id === user.id && row.status === 'scheduled')) {
          throw new Error('You already have an appointment for this hospital call.');
        }
        if (DEMO_APPOINTMENTS.some(row => row.request_id === requestId &&
            row.donor_id === user.id && row.status === 'donated')) {
          throw new Error('Your donation for this hospital call has already been recorded.');
        }
        if ((request.units_confirmed || 0) + activeCount >= request.units) {
          throw new Error('All volunteer appointment places for this call are filled.');
        }
        const appointment = {
          id: `appointment-demo-${Date.now()}-${++demoMessageSequence}`,
          request_id: requestId, donor_id: user.id, hospital_id: request.hospital_id,
          slot_start: slot.toISOString(), status: 'scheduled', hospital_note: null,
          donor_cancel_reason: null, created_at: new Date().toISOString()
        };
        DEMO_APPOINTMENTS.push(appointment);
        ensureDemoThread(request, 'donor_hospital', user.id);
        emitDemoRequestEvent('patient_volunteer', request, request.patient_id);
        const hospitalAccount = DEMO_USERS.find(candidate =>
          candidate.role === 'hospital' && candidate.hospital_id === request.hospital_id);
        emitDemoRequestEvent('hospital_volunteer', request, hospitalAccount && hospitalAccount.id);
        return appointment;
      }
      return run(sb.rpc('lifeline_book_donor_appointment', {
        p_request_id: requestId,
        p_slot_start: slotStart
      }));
    },
    async mine() {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user || user.role !== 'donor') return [];
        return DEMO_APPOINTMENTS.filter(row => row.donor_id === user.id)
          .map(appointment => {
            const request = DEMO_REQUESTS.find(row => row.id === appointment.request_id);
            return { ...appointment, request: request ? demoDonorCall(request) : null };
          }).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      }
      if (!Auth.isDonor) return [];
      const rows = await run(sb.from('donor_appointments')
        .select('id,request_id,donor_id,hospital_id,slot_start,status,hospital_note,donor_cancel_reason,created_at')
        .eq('donor_id', Auth.id).order('slot_start', { ascending: true }));
      if (!rows.length) return [];
      const calls = await run(sb.from('donor_calls')
        .select('id,blood_type,units,units_confirmed,volunteer_count,urgency,status,created_at,hospital_id,hospital_name,hospital_address')
        .in('id', [...new Set(rows.map(row => row.request_id))]));
      const requestById = new Map(calls.map(row => [row.id, row]));
      return rows.map(row => ({ ...row, request: requestById.get(row.request_id) || null }));
    },
    async forHospital() {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user || user.role !== 'hospital') return [];
        return DEMO_APPOINTMENTS.filter(row => row.hospital_id === user.hospital_id &&
          row.status === 'scheduled').map(appointment => {
          const request = DEMO_REQUESTS.find(row => row.id === appointment.request_id);
          return { ...appointment, request: request ? {
            id: request.id, blood_type: request.blood_type, units: request.units,
            urgency: request.urgency, status: request.status, created_at: request.created_at
          } : null };
        }).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      }
      if (!Auth.isHospital) return [];
      const rows = await run(sb.from('donor_appointments')
        .select('id,request_id,donor_id,hospital_id,slot_start,status,created_at')
        .eq('hospital_id', Auth.profile.hospital_id).eq('status', 'scheduled')
        .order('slot_start', { ascending: true }));
      if (!rows.length) return [];
      const requestsForAppointments = await run(sb.from('hospital_requests')
        .select('id,blood_type,units,urgency,status,created_at')
        .in('id', [...new Set(rows.map(row => row.request_id))]));
      const requestById = new Map(requestsForAppointments.map(row => [row.id, row]));
      return rows.map(row => ({ ...row, request: requestById.get(row.request_id) || null }));
    },
    async forRequest(requestId) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user) return null;
        const row = DEMO_APPOINTMENTS.filter(appointment => appointment.request_id === requestId &&
          (user.role === 'donor' ? appointment.donor_id === user.id
            : user.role === 'hospital' && appointment.hospital_id === user.hospital_id))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return row ? { ...row } : null;
      }
      if (!Auth.isDonor) return null;
      return run(sb.from('donor_appointments')
        .select('id,request_id,donor_id,hospital_id,slot_start,status,hospital_note,donor_cancel_reason,created_at')
        .eq('request_id', requestId).eq('donor_id', Auth.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle());
    },
    async cancel(appointmentId, reason) {
      const cleanReason = String(reason || '').trim();
      if (cleanReason.length < 2 || cleanReason.length > 300) {
        throw new Error('Add a short cancellation reason (up to 300 characters).');
      }
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const appointment = DEMO_APPOINTMENTS.find(row => row.id === appointmentId &&
          user && user.role === 'donor' && row.donor_id === user.id && row.status === 'scheduled');
        if (!appointment) throw new Error('Only your scheduled appointment can be cancelled.');
        appointment.status = 'cancelled';
        appointment.donor_cancel_reason = cleanReason;
        const request = DEMO_REQUESTS.find(row => row.id === appointment.request_id);
        if (request) emitDemoRequestEvent('patient_progress', request, request.patient_id);
        return true;
      }
      return run(sb.rpc('lifeline_cancel_donor_appointment', {
        p_appointment_id: appointmentId,
        p_reason: cleanReason
      }));
    },
    async recordOutcome(appointmentId, status, note) {
      if (!['donated', 'deferred', 'no_show'].includes(status) || String(note || '').length > 500) {
        throw new Error('Choose an appointment outcome and use a note of 500 characters or fewer.');
      }
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const appointment = DEMO_APPOINTMENTS.find(row => row.id === appointmentId &&
          user && user.role === 'hospital' && row.hospital_id === user.hospital_id &&
          row.status === 'scheduled');
        if (!appointment) throw new Error('This appointment is not scheduled at your hospital.');
        const request = DEMO_REQUESTS.find(row => row.id === appointment.request_id);
        if (!request) throw new Error('This appointment is not linked to an open hospital call.');
        appointment.status = status;
        appointment.hospital_note = String(note || '').trim() || null;
        if (status === 'donated') {
          const donor = demoUserById(appointment.donor_id);
          if (donor) {
            donor.last_donated_at = new Date().toISOString();
            donor.donation_count = (donor.donation_count || donor.donations || 0) + 1;
            donor.donations = donor.donation_count;
          }
          request.units_confirmed = DEMO_APPOINTMENTS.filter(row =>
            row.request_id === request.id && row.status === 'donated').length;
          if (request.units_confirmed >= request.units) request.status = 'completed';
          emitDemoRequestEvent('donor_thank_you', request, appointment.donor_id);
        }
        if (request.status === 'completed') {
          DEMO_APPOINTMENTS.filter(row => row.request_id === request.id && row.status === 'scheduled')
            .forEach(row => { row.status = 'cancelled'; });
        }
        emitDemoRequestEvent('patient_progress', request, request.patient_id);
        return appointment;
      }
      return run(sb.rpc('lifeline_record_appointment_outcome', {
        p_appointment_id: appointmentId,
        p_status: status,
        p_hospital_note: String(note || '').trim() || null
      }));
    }
  };

  /* ---------------- requests ----------------
     Each role reads a privacy-scoped view. Donors never select requests rows. */
  const requests = {
    async list() {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user) return [];
        if (user.role === 'donor') {
          return DEMO_REQUESTS.filter(r =>
            r.status === 'pending' && r.blood_type === user.blood_type &&
            user.donor_status === 'active' &&
            DEMO_APPOINTMENTS.filter(appointment =>
              appointment.request_id === r.id && ['scheduled', 'donated'].includes(appointment.status)).length < r.units &&
            !DEMO_APPOINTMENTS.some(appointment => appointment.request_id === r.id &&
              appointment.donor_id === user.id && appointment.status === 'scheduled'))
            .map(demoDonorCall);
        }
        if (user.role === 'hospital') {
          return DEMO_REQUESTS.filter(r => r.hospital_id === user.hospital_id)
            .map(r => ({
              ...r,
              units_confirmed: r.units_confirmed || 0,
              volunteer_count: DEMO_APPOINTMENTS.filter(appointment =>
                appointment.request_id === r.id &&
                ['scheduled', 'donated'].includes(appointment.status)).length
            }));
        }
        return DEMO_REQUESTS.filter(r => r.patient_id === user.id).map(demoPatientRequest);
      }
      const view = Auth.isHospital ? 'hospital_requests' : Auth.isDonor ? 'donor_calls' : 'patient_requests';
      const rows = await run(sb.from(view).select('*').order('created_at', { ascending: false }));
      if (!Auth.isDonor || !rows.length) return rows;
      const mine = await appointments.mine();
      const booked = new Set(mine.filter(row => row.status === 'scheduled').map(row => row.request_id));
      return rows.filter(row => row.status === 'pending' && !booked.has(row.id) &&
        (row.volunteer_count || 0) < row.units);
    },
    async get(id) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user) return null;
        const row = DEMO_REQUESTS.find(request => request.id === id &&
          (user.role === 'patient' ? request.patient_id === user.id
            : user.role === 'hospital' ? request.hospital_id === user.hospital_id
              : user.role === 'donor' && request.blood_type === user.blood_type &&
                ((request.status === 'pending' && user.donor_status === 'active') || DEMO_APPOINTMENTS.some(appointment =>
                  appointment.request_id === id && appointment.donor_id === user.id &&
                  ['scheduled', 'donated', 'deferred', 'no_show', 'cancelled'].includes(appointment.status)))));
        if (!row) return null;
        if (user.role === 'donor') {
          const appointment = await appointments.forRequest(id);
          return { ...demoDonorCall(row), appointment };
        }
        return user.role === 'patient' ? demoPatientRequest(row) : row;
      }
      if (!sb) return null;
      const view = Auth.isHospital ? 'hospital_requests' : Auth.isDonor ? 'donor_calls' : 'patient_requests';
      const row = await run(sb.from(view).select('*').eq('id', id).maybeSingle());
      if (Auth.isDonor && row) return { ...row, appointment: await appointments.forRequest(id) };
      return row;
    },
    async create(fields) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const hospital = DEMO_HOSPITALS.find(h => h.id === fields.hospital_id && h.is_approved && h.is_active);
        if (!user || user.role !== 'patient') throw new Error('Only patients can create blood requests.');
        if (!hospital) throw new Error('Choose an approved, active hospital.');
        if (fields.volunteer_ethics_acknowledged !== true) {
          throw new Error('Confirm that donors are unpaid volunteers before sending this request.');
        }
        const id = `req-demo-${Date.now()}-${++demoRequestSequence}`;
        const row = {
          id, patient_id: user ? user.id : 'demo-patient', donor_id: null, status: 'pending_hospital',
          blood_type: fields.blood_type, units: fields.units, urgency: fields.urgency,
          hospital_id: fields.hospital_id,
          hospital_note: null, hospital_decision_at: null, created_at: new Date().toISOString(),
          patient: { id: user ? user.id : 'demo-patient', full_name: user ? user.full_name : 'Demo Patient', phone: user ? user.phone : '+1 555 010 9999', blood_type: fields.blood_type, verified: true, donor_status: 'active', donations: 0, reliability: 92 }, donor: null, declined_by: []
        };
        row.hospital_info = hospital;
        DEMO_REQUESTS.unshift(row);
        ensureDemoThread(row, 'patient_hospital', row.patient_id);
        const hospitalAccount = DEMO_USERS.find(candidate =>
          candidate.role === 'hospital' && candidate.hospital_id === row.hospital_id);
        emitDemoRequestEvent('hospital_incoming', row, hospitalAccount && hospitalAccount.id);
        return demoPatientRequest(row);
      }
      const inserted = await run(sb.from('requests')
        .insert({ ...fields, status: 'pending_hospital' }).select('id').single());
      return requests.get(inserted.id);
    },
    async cancel(id, patientId) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const item = DEMO_REQUESTS.find(r => r.id === id && user && user.role === 'patient' &&
          user.id === patientId && r.patient_id === patientId &&
          ['pending_hospital', 'pending'].includes(r.status));
        if (item) {
          item.status = 'cancelled';
          emitDemoRequestEvent('patient_progress', item, item.patient_id);
        }
        return item ? demoPatientRequest(item) : null;
      }
      const updated = await run(sb.from('requests').update({ status: 'cancelled' })
        .eq('id', id).select('id').maybeSingle());
      return updated ? requests.get(id) : null;
    },
    async reopen(id, patientId) {
      const patch = { status: 'pending_hospital', hospital_note: null, hospital_decision_at: null };
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const item = DEMO_REQUESTS.find(r => r.id === id && user && user.role === 'patient' &&
          user.id === patientId && r.patient_id === patientId && ['declined', 'cancelled'].includes(r.status) &&
          DEMO_HOSPITALS.some(h => h.id === r.hospital_id && h.is_approved && h.is_active));
        if (!item) return null;
        Object.assign(item, patch);
        const hospitalAccount = DEMO_USERS.find(candidate =>
          candidate.role === 'hospital' && candidate.hospital_id === item.hospital_id);
        emitDemoRequestEvent('hospital_incoming', item, hospitalAccount && hospitalAccount.id);
        return demoPatientRequest(item);
      }
      const updated = await run(sb.from('requests').update(patch).eq('id', id)
        .in('status', ['declined', 'cancelled']).not('hospital_id', 'is', null)
        .select('id').maybeSingle());
      return updated ? requests.get(id) : null;
    },
    async edit(id, patch) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const item = DEMO_REQUESTS.find(r => r.id === id && user && user.role === 'patient' &&
          r.patient_id === user.id);
        if (!item) return null;
        const booked = DEMO_APPOINTMENTS.filter(appointment => appointment.request_id === id &&
          appointment.status === 'scheduled').length;
        const confirmed = item.units_confirmed || 0;
        if (patch.units !== undefined && patch.units < confirmed + booked) {
          throw new Error('Units cannot be reduced below the number of confirmed and scheduled volunteers.');
        }
        if (patch.blood_type !== undefined && patch.blood_type !== item.blood_type &&
            DEMO_APPOINTMENTS.some(appointment => appointment.request_id === id &&
              ['scheduled', 'donated'].includes(appointment.status))) {
          throw new Error('Blood type cannot be changed after a volunteer appointment is booked.');
        }
        Object.assign(item, patch);
        return demoPatientRequest(item);
      }
      const updated = await run(sb.from('requests').update(patch).eq('id', id)
        .select('id').maybeSingle());
      return updated ? requests.get(id) : null;
    },
    async decideAtHospital(id, hospitalId, approved, note) {
      const status = approved ? 'pending' : 'hospital_declined';
      const patch = { status, hospital_note: note || null, hospital_decision_at: new Date().toISOString() };
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const item = DEMO_REQUESTS.find(r => r.id === id && user && user.role === 'hospital' &&
          user.hospital_id === hospitalId && r.hospital_id === hospitalId && r.status === 'pending_hospital');
        if (!item) return null;
        Object.assign(item, patch);
        if (approved) {
          emitDemoRequestEvent('patient_approved', item, item.patient_id);
          DEMO_PROFILES.filter(profile => profile.role === 'donor' &&
            profile.donor_status === 'active' && profile.blood_type === item.blood_type)
            .forEach(profile => emitDemoRequestEvent('donor_call', item, profile.id));
        } else {
          emitDemoRequestEvent('patient_declined', item, item.patient_id);
        }
        return item;
      }
      return run(sb.from('requests').update(patch).eq('id', id).eq('hospital_id', hospitalId)
        .eq('status', 'pending_hospital').select('id').maybeSingle());
    },
    async changeHospital(id, patientId, hospitalId) {
      const hospital = (await hospitals.list()).find(h => h.id === hospitalId);
      if (!hospital) throw new Error('Choose an approved, active hospital.');
      const patch = {
        hospital_id: hospitalId, hospital_note: null, hospital_decision_at: null,
        status: 'pending_hospital'
      };

      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const item = DEMO_REQUESTS.find(r => r.id === id && user && user.role === 'patient' &&
          user.id === patientId && r.patient_id === patientId && r.status === 'hospital_declined');
        if (!item) return null;
        Object.assign(item, patch, { hospital_info: hospital });
        const thread = DEMO_THREADS.find(row =>
          row.request_id === id && row.thread_type === 'patient_hospital' && row.participant_id === patientId);
        if (thread) thread.hospital_id = hospitalId;
        const hospitalAccount = DEMO_USERS.find(candidate =>
          candidate.role === 'hospital' && candidate.hospital_id === hospitalId);
        emitDemoRequestEvent('hospital_incoming', item, hospitalAccount && hospitalAccount.id);
        return demoPatientRequest(item);
      }
      const updated = await run(sb.from('requests').update(patch).eq('id', id)
        .eq('status', 'hospital_declined').select('id').maybeSingle());
      return updated ? requests.get(id) : null;
    },
  };

  const prechecks = {
    async save(requestId, answers) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const donor = user && DEMO_PROFILES.find(profile => profile.id === user.id);
        const request = user && DEMO_REQUESTS.find(row => row.id === requestId && row.status === 'pending' &&
          row.blood_type === user.blood_type);
        const answerFlags = [
          'age_18_or_older', 'weight_50kg_or_more', 'feeling_well', 'recent_illness',
          'recent_tattoo', 'recent_travel', 'medication'
        ];
        if (!donor || donor.role !== 'donor') throw new Error('Only donors can complete this pre-check.');
        if (!donor.consent_at || donor.consent_version !== DONOR_CONSENT_VERSION) {
          throw new Error('Review and accept the donor consent statement before volunteering.');
        }
        if (within56Days(donor.last_donated_at)) {
          const eligibleDate = new Date(donor.last_donated_at);
          eligibleDate.setDate(eligibleDate.getDate() + 56);
          throw new Error(`You can volunteer again on ${eligibleDate.toLocaleDateString()}.`);
        }
        const invalidDate = answers.last_donation_date &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(answers.last_donation_date) ||
            Number.isNaN(Date.parse(answers.last_donation_date)) ||
            answers.last_donation_date > new Date().toISOString().slice(0, 10));
        if (!request || answerFlags.some(key => typeof answers[key] !== 'boolean') ||
            typeof answers.never_donated !== 'boolean' || invalidDate ||
            (answers.never_donated && answers.last_donation_date) ||
            (!answers.never_donated && !answers.last_donation_date)) {
          throw new Error('Complete each pre-check answer before continuing.');
        }
        const reportedRecent = within56Days(answers.last_donation_date);
        const profileRecent = within56Days(donor.last_donated_at);
        const flags = {
          request_id: request.id,
          donor_id: donor.id,
          hospital_id: request.hospital_id,
          age_18_or_older: answers.age_18_or_older,
          weight_50kg_or_more: answers.weight_50kg_or_more,
          feeling_well: answers.feeling_well,
          recent_illness: answers.recent_illness,
          recent_tattoo: answers.recent_tattoo,
          recent_travel: answers.recent_travel,
          medication: answers.medication,
          recent_donation: !!reportedRecent || !!profileRecent
        };
        flags.result = flags.age_18_or_older && flags.weight_50kg_or_more && flags.feeling_well &&
          !flags.recent_illness && !flags.recent_tattoo && !flags.recent_travel &&
          !flags.medication && !flags.recent_donation ? 'Pre-check passed' : 'Please ask the hospital';
        const index = DEMO_PRECHECKS.findIndex(row => row.request_id === request.id && row.donor_id === donor.id);
        if (index >= 0) DEMO_PRECHECKS[index] = flags;
        else DEMO_PRECHECKS.push(flags);
        return flags.result;
      }
      return run(sb.rpc('lifeline_save_donor_precheck', {
        p_request_id: requestId,
        p_age_18_or_older: answers.age_18_or_older,
        p_weight_50kg_or_more: answers.weight_50kg_or_more,
        p_feeling_well: answers.feeling_well,
        p_recent_illness: answers.recent_illness,
        p_recent_tattoo: answers.recent_tattoo,
        p_recent_travel: answers.recent_travel,
        p_medication: answers.medication,
        p_last_donation_date: answers.last_donation_date || null,
        p_never_donated: answers.never_donated
      }));
    },
    async list() {
      const user = demoModeEnabled() ? demoCurrentUser() : null;
      if (demoModeEnabled()) {
        if (!user) return [];
        return DEMO_PRECHECKS.filter(row => user.role === 'hospital'
          ? row.hospital_id === user.hospital_id &&
            DEMO_APPOINTMENTS.some(appointment => appointment.request_id === row.request_id &&
              appointment.donor_id === row.donor_id && appointment.hospital_id === user.hospital_id &&
              ['scheduled', 'donated', 'deferred', 'no_show'].includes(appointment.status))
          : user.role === 'donor' && row.donor_id === user.id);
      }
      return run(sb.from('donor_prechecks')
        .select('request_id,donor_id,hospital_id,age_18_or_older,weight_50kg_or_more,feeling_well,recent_illness,recent_tattoo,recent_travel,medication,recent_donation,created_at')
        .order('created_at', { ascending: false }));
    }
  };

  const messages = {
    async getThreads() {
      const user = demoModeEnabled() ? demoCurrentUser() : null;
      if (demoModeEnabled()) {
        if (!user) return [];
        return DEMO_THREADS.filter(thread => demoCanSeeThread(thread, user))
          .map(thread => demoThreadDetails(thread, user))
          .sort((a, b) => (b.last_message ? b.last_message.created_at : b.created_at)
            .localeCompare(a.last_message ? a.last_message.created_at : a.created_at));
      }
      const threads = await run(sb.from('chat_threads')
        .select('id,request_id,hospital_id,thread_type,participant_id,created_at')
        .order('created_at', { ascending: false }));
      if (!threads.length) return [];
      const requestView = Auth.isHospital ? 'hospital_requests' :
        Auth.isDonor ? 'donor_calls' : 'patient_requests';
      const requestsForThreads = await run(sb.from(requestView)
        .select('id,blood_type,urgency,status')
        .in('id', threads.map(thread => thread.request_id)));
      const requestById = new Map(requestsForThreads.map(request => [request.id, request]));
      const enriched = await Promise.all(threads.map(async thread => {
        const latest = await run(sb.from('chat_messages')
          .select('body,sender_id,created_at')
          .eq('thread_id', thread.id)
          .order('created_at', { ascending: false })
          .limit(1));
        const unread = await run(sb.from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', thread.id).neq('sender_id', Auth.id).is('read_at', null));
        return {
          ...thread,
          request: requestById.get(thread.request_id) || null,
          counterpart: Auth.isHospital
            ? (thread.thread_type === 'patient_hospital' ? 'Patient' : 'Donor')
            : 'Hospital',
          last_message: latest[0] || null,
          unread_count: unread.count || 0
        };
      }));
      return enriched;
    },
    async getThreadForRequest(requestId, threadType, participantId) {
      const user = demoModeEnabled() ? demoCurrentUser() : null;
      if (demoModeEnabled()) {
        const thread = DEMO_THREADS.find(item =>
          item.request_id === requestId && item.thread_type === threadType &&
          (!participantId || item.participant_id === participantId) &&
          demoCanSeeThread(item, user));
        return thread ? demoThreadDetails(thread, user) : null;
      }
      let query = sb.from('chat_threads').select('id,request_id,hospital_id,thread_type,participant_id,created_at')
        .eq('request_id', requestId).eq('thread_type', threadType);
      if (participantId) query = query.eq('participant_id', participantId);
      return run(query.maybeSingle());
    },
    async getMessages(threadId) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const thread = DEMO_THREADS.find(item => item.id === threadId && demoCanSeeThread(item, user));
        if (!thread) return [];
        return DEMO_MESSAGES.filter(message => message.thread_id === threadId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
      }
      return runTimedQuery(sb.from('chat_messages').select('id,thread_id,sender_id,body,created_at,read_at')
        .eq('thread_id', threadId).order('created_at', { ascending: true }), 'Loading messages');
    },
    async sendMessage(threadId, senderId, body) {
      const clean = String(body || '').trim();
      if (!clean) throw new Error('Write a message before sending.');
      if (clean.length > 1000) throw new Error('Messages can be up to 1000 characters.');
      const now = Date.now();
      const sentAt = messageSendTimes.get(senderId) || 0;
      if (now - sentAt < 1000) throw new Error('Please wait a moment before sending another message.');
      messageSendTimes.set(senderId, now);

      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const thread = DEMO_THREADS.find(item => item.id === threadId && demoCanSeeThread(item, user));
        if (!thread || !user || user.id !== senderId) throw new Error('This conversation is not available to your account.');
        const message = {
          id: `message-demo-${Date.now()}-${++demoMessageSequence}`,
          thread_id: threadId, sender_id: user.id, body: clean,
          created_at: new Date().toISOString(), read_at: null
        };
        DEMO_MESSAGES.push(message);
        demoMessageListeners.forEach(listener => listener({ eventType: 'INSERT', new: message, old: {} }));
        return message;
      }
      return runTimedQuery(sb.from('chat_messages')
        .insert({ thread_id: threadId, sender_id: senderId, body: clean })
        .select('id,thread_id,sender_id,body,created_at,read_at').single(), 'Sending message');
    },
    async markRead(threadId) {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const thread = DEMO_THREADS.find(item => item.id === threadId && demoCanSeeThread(item, user));
        if (!thread || !user) throw new Error('This conversation is not available to your account.');
        const now = new Date().toISOString();
        DEMO_MESSAGES.forEach(message => {
          if (message.thread_id === threadId && message.sender_id !== user.id && !message.read_at) {
            message.read_at = now;
          }
        });
        demoMessageListeners.forEach(listener => listener({ eventType: 'UPDATE', new: { thread_id: threadId }, old: {} }));
        return true;
      }
      const result = await run(sb.from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('thread_id', threadId).neq('sender_id', Auth.id).is('read_at', null)
        .select('id'));
      return result;
    },
    async getUnreadCount() {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user) return 0;
        const visible = DEMO_THREADS.filter(thread => demoCanSeeThread(thread, user));
        return DEMO_MESSAGES.filter(message => visible.some(thread => thread.id === message.thread_id) &&
          message.sender_id !== user.id && !message.read_at).length;
      }
      const threads = await run(sb.from('chat_threads').select('id'));
      if (!threads.length) return 0;
      const result = await run(sb.from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .in('thread_id', threads.map(thread => thread.id))
        .neq('sender_id', Auth.id).is('read_at', null));
      return result.count || 0;
    },
    subscribeMessages(onChange) {
      if (demoModeEnabled()) {
        demoMessageListeners.add(onChange);
        return () => demoMessageListeners.delete(onChange);
      }
      if (!sb) return () => {};
      let channel;
      try {
        channel = sb.channel(`messages-live-${Auth.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, onChange)
          .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              UI.toast('Live message updates are off. Reopen Messages to refresh.', 'bad');
              try { sb.removeChannel(channel); } catch (e) { /* already gone */ }
            }
          });
      } catch (e) {
        console.warn('Message realtime unavailable', e);
        return () => {};
      }
      return () => { try { sb.removeChannel(channel); } catch (e) { /* already gone */ } };
    }
  };

  const reports = {
    async submit(requestId, reason, details, threadId) {
      const allowedReasons = new Set([
        'payment_requested_offered', 'suspicious_request', 'harassment', 'other'
      ]);
      const cleanDetails = String(details || '').trim();
      if (!allowedReasons.has(reason) || cleanDetails.length > 1000) {
        throw new Error('Choose a report reason and keep details to 1000 characters or fewer.');
      }
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        const request = DEMO_REQUESTS.find(row => row.id === requestId);
        const thread = threadId && DEMO_THREADS.find(row =>
          row.id === threadId && row.request_id === requestId && demoCanSeeThread(row, user));
        const related = request && user && (
          (user.role === 'patient' && request.patient_id === user.id) ||
          (user.role === 'hospital' && request.hospital_id === user.hospital_id) ||
          (user.role === 'donor' && (
            DEMO_APPOINTMENTS.some(appointment =>
              appointment.request_id === requestId && appointment.donor_id === user.id) ||
            (request.status === 'pending' && request.blood_type === user.blood_type &&
              user.donor_status === 'active')
          ))
        );
        if (!related || (threadId && !thread)) {
          throw new Error('This request or conversation is not available for reporting.');
        }
        const report = {
          id: `report-demo-${Date.now()}-${++demoMessageSequence}`,
          request_id: requestId,
          hospital_id: request.hospital_id,
          thread_id: threadId || null,
          reporter_role: user.role,
          reason,
          details: cleanDetails || null,
          created_at: new Date().toISOString()
        };
        DEMO_REPORTS.push(report);
        return report.id;
      }
      return run(sb.rpc('lifeline_submit_abuse_report', {
        p_request_id: requestId,
        p_reason: reason,
        p_details: cleanDetails || null,
        p_thread_id: threadId || null
      }));
    },
    async list() {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user || user.role !== 'hospital') return [];
        return DEMO_REPORTS.filter(report => report.hospital_id === user.hospital_id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      if (!Auth.isHospital) return [];
      return run(sb.from('abuse_reports')
        .select('id,request_id,reporter_role,reason,details,created_at')
        .order('created_at', { ascending: false }));
    }
  };

  const audit = {
    async list() {
      if (demoModeEnabled()) return [];
      if (!Auth.isHospital) return [];
      return run(sb.from('request_audit_events')
        .select('id,request_id,event,from_status,to_status,note,created_at')
        .order('created_at', { ascending: false }).limit(100));
    }
  };

  /* ---------------- view ---------------- */
  const views = {
    async volunteerRegistry() {
      if (demoModeEnabled()) {
        const user = demoCurrentUser();
        if (!user || user.role !== 'hospital') return [];
        const counts = new Map();
        DEMO_PROFILES.filter(profile => profile.role === 'donor' &&
          profile.donor_status === 'active' && profile.blood_type)
          .forEach(profile => counts.set(profile.blood_type, (counts.get(profile.blood_type) || 0) + 1));
        return Array.from(counts, ([blood_type, volunteer_count]) => ({ blood_type, volunteer_count }));
      }
      if (!sb) return [];
      return run(sb.from('hospital_volunteer_registry')
        .select('blood_type,volunteer_count').order('blood_type'));
    }
  };

  /* ---------------- realtime (recipient-scoped request events) ---------------- */
  function watchRequests(onChange) {
    if (demoModeEnabled()) {
      demoRequestListeners.add(onChange);
      return () => demoRequestListeners.delete(onChange);
    }
    if (!sb) return () => {};
    let channel;
    try {
      channel = sb.channel('request-events-live', {
        config: { broadcast: { self: true } }
      }).on('postgres_changes', { event: '*', schema: 'public', table: 'request_events' }, payload => {
        onChange(payload);
      }).subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          UI.toast('Live updates are off. Pull to refresh manually.', 'bad');
          try { sb.removeChannel(channel); } catch (e) { /* already gone */ }
        }
      });
    } catch (e) {
      console.warn('realtime unavailable', e);
      return () => {};
    }
    return () => { try { sb.removeChannel(channel); } catch (e) { /* already gone */ } };
  }

  return {
    donorConsentVersion: DONOR_CONSENT_VERSION,
    ready: !configMissing && !!sb,
    auth, profiles, hospitals, requests, appointments, prechecks, messages, reports, audit, views,
    watchRequests
  };
})();
