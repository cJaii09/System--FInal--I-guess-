const MessagesWidget = (() => {
  const SAFETY_NOTICE = 'Do not share passwords or ID numbers. Do not offer or ask for payment.';
  let root = null;
  let panel = null;
  let content = null;
  let badge = null;
  let unsubscribe = null;
  let open = false;
  let currentThread = null;
  let ownerId = null;
  let lastSentAt = 0;
  let loadingThread = false;

  function setOpen(value) {
    open = value;
    panel.hidden = !open;
    root.querySelector('[data-messages-toggle]').setAttribute('aria-expanded', String(open));
    if (open && !currentThread) refreshList();
  }

  function reportConversationForm(thread) {
    const details = document.createElement('details');
    details.className = 'messages-report';
    const summary = el('summary', '', 'Report this conversation');
    const form = document.createElement('form');
    form.className = 'stack';
    const reason = document.createElement('select');
    reason.className = 'select';
    reason.required = true;
    reason.setAttribute('aria-label', 'Report reason');
    [
      ['', 'Choose a reason'],
      ['payment_requested_offered', 'Payment requested or offered'],
      ['suspicious_request', 'Suspicious request'],
      ['harassment', 'Harassment'],
      ['other', 'Other']
    ].forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      reason.appendChild(option);
    });
    const note = document.createElement('textarea');
    note.className = 'textarea';
    note.rows = 2;
    note.maxLength = 1000;
    note.placeholder = 'Optional details. Do not include passwords, ID numbers or medical details.';
    note.setAttribute('aria-label', 'Optional report details');
    const status = el('p', 'messages-error');
    status.setAttribute('aria-live', 'polite');
    const send = actionButton('Send report to the hospital', null, 'btn btn--danger-ghost btn--sm');
    send.type = 'submit';
    form.append(reason, note, status, send);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!reason.value) {
        status.textContent = 'Choose a reason for this report.';
        reason.focus();
        return;
      }
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        await API.reports.submit(thread.request_id, reason.value, note.value, thread.id);
        form.reset();
        status.textContent = 'Thank you. The hospital can review this report.';
        UI.toast('Report sent to the hospital for review.');
      } catch (error) {
        status.textContent = UI.humanError(error);
      } finally {
        send.disabled = false;
        send.textContent = 'Send report to the hospital';
      }
    });
    details.append(summary, form);
    return details;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function threadDescription(thread) {
    const req = thread.request || {};
    const status = String(req.status || '').replace(/_/g, ' ');
    return [req.blood_type, req.urgency, status].filter(Boolean).join(' · ');
  }

  function refreshBadge() {
    if (!Auth.profile || !badge) return;
    API.messages.getUnreadCount().then(count => {
      if (!badge || !badge.isConnected) return;
      badge.hidden = count < 1;
      badge.textContent = count > 99 ? '99+' : String(count);
      root.querySelector('[data-messages-toggle]').setAttribute('aria-label',
        count ? `Messages, ${count} unread` : 'Messages');
    }).catch(error => console.warn('Could not refresh unread message count', error));
  }

  async function refreshList() {
    if (!content || !Auth.profile) return;
    currentThread = null;
    content.replaceChildren();
    const list = el('div', 'messages-thread-list');
    content.appendChild(list);
    try {
      const threads = await API.messages.getThreads();
      if (!content || !content.isConnected || currentThread) return;
      list.replaceChildren();
      if (!threads.length) {
        list.appendChild(el('p', 'messages-empty', 'No conversations yet. Messages appear here once you send or accept a request.'));
        refreshBadge();
        return;
      }
      threads.forEach(thread => {
        const button = el('button', 'messages-thread');
        button.type = 'button';
        const summary = el('span', 'messages-thread__summary');
        summary.appendChild(el('strong', 'messages-thread__title',
          `${Auth.isHospital ? `Message ${thread.counterpart.toLowerCase()}` : 'Message hospital'} · ${threadDescription(thread)}`));
        summary.appendChild(el('span', 'messages-thread__preview',
          thread.last_message ? thread.last_message.body : 'Start a conversation'));
        const right = el('span', 'messages-thread__meta');
        right.appendChild(el('time', '', thread.last_message ? UI.timeAgo(thread.last_message.created_at) : ''));
        if (thread.unread_count) right.appendChild(el('span', 'messages-unread-dot'));
        button.append(summary, right);
        button.addEventListener('click', () => openThread(thread));
        list.appendChild(button);
      });
      refreshBadge();
    } catch (error) {
      list.replaceChildren(el('p', 'messages-error', UI.humanError(error)));
      list.appendChild(actionButton('Try again', refreshList));
    }
  }

  function actionButton(label, handler, className) {
    const button = el('button', className || 'btn btn--soft btn--sm', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  async function openThread(thread) {
    if (!content || !thread) return;
    currentThread = thread;
    loadingThread = true;
    const view = document.createElement('div');
    view.className = 'messages-conversation';
    const top = document.createElement('div');
    top.className = 'messages-conversation__top';
    const back = actionButton('‹ All messages', refreshList, 'messages-back');
    const title = el('strong', '', Auth.isHospital ? thread.counterpart : 'Hospital');
    const detail = el('small', '', threadDescription(thread));
    const heading = el('div', 'messages-conversation__heading');
    heading.append(title, detail);
    top.append(back, heading);
    view.appendChild(top);
    view.appendChild(el('p', 'messages-safety', SAFETY_NOTICE));
    view.appendChild(el('p', 'messages-safety', 'For emergencies, call your local emergency number.'));
    view.appendChild(reportConversationForm(thread));
    const body = el('div', 'messages-conversation__body');
    body.setAttribute('aria-live', 'polite');
    body.appendChild(el('p', 'messages-loading', 'Loading messages…'));
    view.appendChild(body);
    const form = document.createElement('form');
    form.className = 'messages-compose';
    const input = document.createElement('textarea');
    input.className = 'textarea';
    input.maxLength = 1000;
    input.rows = 2;
    input.placeholder = 'Write a message…';
    input.setAttribute('aria-label', 'Write a message');
    const send = actionButton('Send', null, 'btn btn--primary btn--sm');
    send.type = 'submit';
    form.append(input, send);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const bodyText = input.value.trim();
      if (!bodyText) { input.focus(); return; }
      if (Date.now() - lastSentAt < 1000) {
        showConversationError(body, 'Please wait a moment before sending another message.');
        return;
      }
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        const sent = await API.messages.sendMessage(thread.id, Auth.id, bodyText);
        lastSentAt = Date.now();
        input.value = '';
        appendConversationMessage(sent, body);
        refreshBadge();
      } catch (error) {
        showConversationError(body, UI.humanError(error));
      } finally {
        send.disabled = false;
        send.textContent = 'Send';
        input.focus();
      }
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    view.appendChild(form);
    content.replaceChildren(view);

    try {
      await API.messages.markRead(thread.id);
      await renderConversationMessages(thread, body);
      refreshBadge();
    } catch (error) {
      body.replaceChildren(el('p', 'messages-error', UI.humanError(error)));
    } finally {
      loadingThread = false;
    }
  }

  function showConversationError(body, text) {
    const error = el('p', 'messages-error', text);
    body.appendChild(error);
    body.scrollTop = body.scrollHeight;
  }

  async function renderConversationMessages(thread, body) {
    const messages = await API.messages.getMessages(thread.id);
    if (!body || !body.isConnected) return;
    body.replaceChildren();
    messages.forEach(message => appendConversationMessage(message, body));
    if (!messages.length) body.appendChild(el('p', 'messages-empty', 'No messages yet. Say hello.'));
    body.scrollTop = body.scrollHeight;
  }

  function appendConversationMessage(message, body) {
    if (!message || !body || !body.isConnected) return;
    const outgoing = message.sender_id === Auth.id;
    const row = el('div', `message-row${outgoing ? ' message-row--outgoing' : ''}`);
    const bubble = el('p', `message-bubble${outgoing ? ' message-bubble--outgoing' : ''}`, message.body);
    row.appendChild(bubble);
    row.appendChild(el('time', 'message-time', new Date(message.created_at).toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit'
    })));
    const emptyState = body.querySelector('.messages-empty');
    if (emptyState) emptyState.remove();
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  async function openForRequest(requestId, threadType, participantId) {
    if (!Auth.profile) return;
    if (typeof LIAChat !== 'undefined') LIAChat.close();
    if (!open) setOpen(true);
    try {
      const thread = await API.messages.getThreadForRequest(requestId, threadType, participantId);
      if (!thread) {
        UI.toast('This conversation is not available to your account.', 'bad');
        return;
      }
      thread.counterpart = Auth.isHospital ? (threadType === 'patient_hospital' ? 'Patient' : 'Donor') : 'Hospital';
      thread.request = thread.request || {};
      if (!thread.request.blood_type) {
        const requests = await API.requests.list();
        const request = requests.find(row => row.id === requestId);
        if (request) {
          thread.request = { blood_type: request.blood_type, urgency: request.urgency, status: request.status };
        }
      }
      await openThread(thread);
    } catch (error) {
      UI.toast(UI.humanError(error), 'bad');
    }
  }

  function mount() {
    if (!Auth.profile) { clear(); return; }
    if (ownerId !== Auth.id) {
      ownerId = Auth.id;
      currentThread = null;
      open = false;
    }
    root = document.createElement('div');
    root.className = 'floating-widget floating-widget--messages';
    root.innerHTML = `
      <section class="floating-panel messages-panel" data-messages-panel hidden aria-label="Messages">
        <header class="floating-panel__header">
          <span class="floating-panel__title">Messages<small>Request conversations</small></span>
          <button class="floating-panel__close" type="button" data-messages-close aria-label="Close Messages">×</button>
        </header>
        <div class="messages-content" data-messages-content></div>
      </section>
      <button class="floating-button floating-button--messages" type="button" data-messages-toggle
        title="Messages" aria-label="Messages" aria-expanded="${open}">
        ${UI.icon('message')}<span class="floating-unread" data-messages-badge hidden></span>
      </button>`;
    document.body.appendChild(root);
    panel = root.querySelector('[data-messages-panel]');
    content = root.querySelector('[data-messages-content]');
    badge = root.querySelector('[data-messages-badge]');
    setOpen(open);
    root.querySelector('[data-messages-toggle]').addEventListener('click', () => {
      if (typeof LIAChat !== 'undefined') LIAChat.close();
      setOpen(!open);
    });
    root.querySelector('[data-messages-close]').addEventListener('click', () => setOpen(false));
    if (unsubscribe) unsubscribe();
    unsubscribe = API.messages.subscribeMessages(payload => {
      refreshBadge();
      if (!open || !content) return;
      if (payload.eventType === 'INSERT' && payload.new && payload.new.sender_id === Auth.id) return;
      if (currentThread && payload.new && payload.new.thread_id === currentThread.id) {
        if (!loadingThread) renderConversationMessages(currentThread, content.querySelector('.messages-conversation__body'))
          .then(() => API.messages.markRead(currentThread.id))
          .catch(error => console.warn('Could not refresh conversation', error));
      } else if (!currentThread) refreshList();
    });
    refreshBadge();
    if (open) {
      if (currentThread) openThread(currentThread);
      else refreshList();
    }
  }

  function unmount() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (root) root.remove();
    root = panel = content = badge = null;
  }

  function clear() {
    unmount();
    open = false;
    currentThread = null;
    ownerId = null;
    lastSentAt = 0;
    loadingThread = false;
  }

  function close() {
    if (panel) setOpen(false);
    else open = false;
  }

  return { mount, unmount, clear, close, openForRequest };
})();
