const LIAChat = (() => {
  let root = null;
  let panel = null;
  let transcript = null;
  let input = null;
  let sendButton = null;
  let history = [];
  let open = false;
  let ownerId = null;
  let sending = false;
  let sendSequence = 0;

  const quickReplies = {
    patient: ['How do I request blood?', 'What happens after I send a request?', 'How do I message the hospital?'],
    donor: ['What happens at hospital screening?', 'How do I volunteer for a call?', 'How often can I donate?'],
    hospital: ['How do I approve a request?', 'What does decline do?']
  };
  const greeting = "Hi, I'm LIA, your Lifeline assistant. How can I help?";

  function demoFaqReply(question, role) {
    const text = String(question || '').toLowerCase();
    const has = pattern => pattern.test(text);
    if (has(/\b(pay|paying|paid|payment|money|cash|buy|sell|sale|fee|purchase|compensation|reward)\b/) ||
        has(/\b(meet|contact|call|text|message|reach|get|email|find|search|browse)\b.*\b(donor|volunteer)\b/) ||
        has(/\b(donor|volunteer)\b.*\b(phone|number|contact|call|reach|message|email|address|identity|name)\b/)) {
      return 'Lifeline does not support paying for blood or privately contacting donors. Donation is voluntary and unpaid; please use the hospital process and contact your hospital through Messages.';
    }
    if (has(/\b(emergency|urgent|life.?threatening|bleeding|unconscious)\b/)) {
      return 'For an emergency, call your local emergency services or go to the nearest hospital now. Do not wait for an app response.';
    }
    if (has(/\b(request blood|need blood|create.*request|submit.*request)\b/)) {
      return role === 'patient'
        ? 'Open Request blood, choose an approved hospital, and submit your request. The hospital reviews it first and, if approved, coordinates a call for voluntary donors.'
        : 'A patient sends a request to a hospital, and the hospital reviews it before coordinating next steps. Donors do not contact patients directly.';
    }
    if (has(/\b(what happens after|after.*(send|submit)|once.*(send|submit))\b/)) {
      return 'The chosen hospital reviews your request first and may approve it or ask for more information. If approved, the hospital coordinates a call for voluntary donors and Lifeline shows progress.';
    }
    if (has(/\b(verify|verification|approve|review)\b/)) {
      return role === 'hospital'
        ? 'Review the incoming request in the Requests tab and approve it or decline it with a note. Approval lets the hospital coordinate a call for voluntary donors.'
        : 'The selected hospital reviews each request before calling for voluntary donors. You can see request progress in Lifeline.';
    }
    if (has(/\b(timeout|no response|haven.t heard|how long|waiting)\b/)) {
      return 'If the hospital does not respond in time, Lifeline marks the request as No response. The patient can then choose another hospital; for urgent needs, contact emergency services or a hospital directly.';
    }
    if (has(/\b(volunteer|volunteering|accept.*call|respond.*call|donate)\b/) &&
        !has(/\b(eligible|eligibility|fit|screen|how often|56|cooldown|last donation)\b/)) {
      return 'Open Calls for voluntary donors, complete the self-check, and choose an available appointment if you wish to volunteer. The hospital screens volunteers in person and makes the final decision.';
    }
    if (has(/\b(appointment|book|slot|schedule)\b/)) {
      return 'Open an eligible hospital call, complete the pre-check, and choose an available appointment time. You can cancel your appointment in Lifeline if your plans change.';
    }
    if (has(/\b(56|cooldown|last donation|donated recently|wait.*donat|donat.*again|how often)\b/)) {
      return 'Lifeline requires a 56-day wait after a confirmed donation before volunteering again. The app shows the date you may volunteer again; ask the hospital if you have questions.';
    }
    if (has(/\b(eligible|eligibility|fit to donate|medical|screening|pre.?check|health)\b/)) {
      return 'Lifeline’s self-check is not medical clearance and cannot determine whether a specific person can donate. The hospital makes the final eligibility decision during its medical screening.';
    }
    if (has(/\b(privacy|private|data|identity|anonymous|phone|address)\b/)) {
      return 'Lifeline shares only the information needed for the hospital-led process, and donors do not see patient identities. Do not share passwords, ID numbers, or sensitive health details in chat.';
    }
    if (has(/\b(message|chat|contact|talk to|speak to)\b/) && has(/\b(hospital|staff|nurse)\b/)) {
      return 'Use the Messages button to contact the hospital connected to your request or appointment. Lifeline does not provide direct patient-to-donor messaging.';
    }
    if (has(/\b(deferred|no.?show|donated|completed|progress|status|what happens after)\b/)) {
      return 'The hospital records whether a volunteer donated, was deferred, or did not attend. Patients see progress and an aggregate volunteer count, not volunteer identities.';
    }
    return 'I can share general information, but I am not a doctor and cannot assess an individual’s health or eligibility. For personal medical advice, contact a healthcare professional; for emergencies, call local emergency services.';
  }

  function addBubble(role, text, target = transcript) {
    if (!target) return null;
    const row = document.createElement('div');
    row.className = `lia-message lia-message--${role}`;
    const bubble = document.createElement('p');
    bubble.className = 'lia-message__bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    target.appendChild(row);
    target.scrollTop = target.scrollHeight;
    return row;
  }

  function setOpen(value) {
    open = value;
    panel.hidden = !open;
    root.querySelector('[data-lia-toggle]').setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }

  async function send(text) {
    const clean = String(text || '').trim();
    if (!clean || sending) return;
    sending = true;
    const requestId = ++sendSequence;
    const requestOwner = ownerId;
    const activeInput = input;
    history.push({ role: 'user', text: clean.slice(0, 500) });
    addBubble('user', clean.slice(0, 500));
    activeInput.value = '';
    sendButton.disabled = true;
    const typing = addBubble('assistant', 'LIA is typing…');
    if (typing) typing.classList.add('lia-message--typing');
    const slowNotice = setTimeout(() => {
      if (typing && typing.isConnected) typing.querySelector('.lia-message__bubble').textContent =
        'LIA is taking longer than expected. You can keep using Lifeline while it responds…';
    }, 4000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const accessToken = Auth.session && Auth.session.access_token;
      if (accessToken && accessToken.startsWith('demo-')) {
        if (typing) typing.remove();
        const reply = demoFaqReply(clean, Auth.profile.role);
        history.push({ role: 'assistant', text: reply });
        addBubble('assistant', reply);
        return;
      }
      if (!accessToken) {
        throw new Error('Please sign in again to use LIA.');
      }
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ messages: history.slice(-10) }),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.reply !== 'string') {
        throw new Error(payload.error || 'LIA is unavailable right now.');
      }
      if (requestId !== sendSequence || requestOwner !== ownerId) return;
      if (typing) typing.remove();
      history.push({ role: 'assistant', text: payload.reply });
      addBubble('assistant', payload.reply);
    } catch (error) {
      if (requestId !== sendSequence || requestOwner !== ownerId) return;
      if (typing) typing.remove();
      const message = error && error.name === 'AbortError'
        ? 'LIA is taking too long to respond. Please try again in a moment.'
        : error && error.message && error.message !== 'Failed to fetch'
          ? error.message
          : 'I can’t reach the assistant right now. Please try again in a moment.';
      addBubble('assistant', message);
    } finally {
      clearTimeout(slowNotice);
      clearTimeout(timeout);
      if (requestId === sendSequence) {
        sending = false;
        if (sendButton) sendButton.disabled = false;
        if (input) input.focus();
      }
    }
  }

  function mount() {
    if (!Auth.profile) { clear(); return; }
    if (ownerId !== Auth.id) {
      history = [];
      open = false;
      ownerId = Auth.id;
    }
    root = document.createElement('div');
    root.className = 'floating-widget floating-widget--lia';
    root.innerHTML = `
      <section class="floating-panel lia-panel" data-lia-panel hidden aria-label="LIA assistant">
        <header class="floating-panel__header">
          <span class="floating-panel__title">LIA<small>Lifeline Intelligent Assistant</small></span>
          <button class="floating-panel__close" type="button" data-lia-close aria-label="Close LIA">×</button>
        </header>
        <div class="lia-transcript" data-lia-transcript aria-live="polite"></div>
        <div class="lia-compose">
          <input class="input" data-lia-input maxlength="500" placeholder="Ask LIA…" aria-label="Message LIA">
          <button class="btn btn--primary btn--sm" data-lia-send type="button">Send</button>
        </div>
      </section>
      <button class="floating-button floating-button--lia" type="button" data-lia-toggle
        title="Ask LIA" aria-label="Ask LIA" aria-expanded="${open}">${UI.icon('sparkle')}</button>`;
    document.body.appendChild(root);
    panel = root.querySelector('[data-lia-panel]');
    transcript = root.querySelector('[data-lia-transcript]');
    input = root.querySelector('[data-lia-input]');
    sendButton = root.querySelector('[data-lia-send]');
    sendButton.disabled = sending;
    setOpen(open);

    root.querySelector('[data-lia-toggle]').addEventListener('click', () => {
      if (typeof MessagesWidget !== 'undefined') MessagesWidget.close();
      setOpen(!open);
    });
    root.querySelector('[data-lia-close]').addEventListener('click', () => setOpen(false));
    sendButton.addEventListener('click', () => send(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(input.value);
      }
    });

    if (!history.length) {
      addBubble('assistant', greeting);
      const chips = document.createElement('div');
      chips.className = 'lia-quick-replies';
      (quickReplies[Auth.profile.role] || quickReplies.patient).forEach(text => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = text;
        chip.addEventListener('click', () => send(text));
        chips.appendChild(chip);
      });
      transcript.appendChild(chips);
    } else {
      history.forEach(message => addBubble(message.role, message.text));
    }
  }

  function unmount() {
    if (root) root.remove();
    root = panel = transcript = input = sendButton = null;
  }

  function clear() {
    unmount();
    sendSequence++;
    history = [];
    open = false;
    ownerId = null;
    sending = false;
  }

  function close() {
    if (panel) {
      open = false;
      panel.hidden = true;
      const toggle = root.querySelector('[data-lia-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    } else open = false;
  }

  return { mount, unmount, clear, close };
})();
