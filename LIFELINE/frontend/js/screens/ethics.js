function donorConsentScreen(main) {
  if (!Auth.isDonor) {
    main.innerHTML = UI.empty('Donor account required', 'This consent statement is for volunteer donors.');
    return;
  }

  main.innerHTML = `
    <section class="card section">
      <p class="eyebrow">Required before continuing</p>
      <h1>Donor consent</h1>
      <p class="lede">Please read and confirm how Lifeline coordinates voluntary blood donation.</p>
      <ul class="ethics-list">
        <li>Donation is voluntary and unpaid. I will not accept or ask for payment.</li>
        <li>The hospital makes the final medical eligibility decision and screens volunteers in person.</li>
        <li>I agree to share only the minimum information needed with the hospital for coordination.</li>
      </ul>
      <p class="small muted">Lifeline does not store blood, test blood, or decide whether anyone is medically eligible.</p>
      <form id="donor-consent-form" novalidate>
        <label class="consent-check">
          <input type="checkbox" id="donor-consent-accepted">
          <span>I understand and agree to this donor consent statement.</span>
        </label>
        <div id="donor-consent-error" aria-live="polite"></div>
        <button class="btn btn--primary btn--block" type="submit" id="donor-consent-submit">Agree and continue</button>
      </form>
    </section>
    <button class="btn btn--danger-ghost btn--block" type="button" data-act="signout">Log out</button>`;

  const form = main.querySelector('#donor-consent-form');
  const checkbox = main.querySelector('#donor-consent-accepted');
  const error = main.querySelector('#donor-consent-error');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    if (!checkbox.checked) {
      error.innerHTML = UI.errorBox('Please confirm the donor consent statement to continue.');
      checkbox.focus();
      return;
    }

    const done = UI.busy(main.querySelector('#donor-consent-submit'), 'Saving…');
    try {
      await Auth.acceptDonorConsent();
      UI.toast('Your donor consent was recorded.');
      Router.go('#/home');
    } catch (e) {
      done();
      error.innerHTML = UI.errorBox(UI.humanError(e));
    }
  });

  const signout = main.querySelector('[data-act="signout"]');
  signout.addEventListener('click', () => Auth.signOut());
}

function ethicsScreen(main) {
  main.innerHTML = `
    <section class="card section">
      <p class="eyebrow">How Lifeline works</p>
      <h1>Care, coordinated by hospitals</h1>
      <ul class="ethics-list">
        <li>Blood donation is voluntary and unpaid. Do not offer, request, or accept payment.</li>
        <li>Patients send requests to a hospital. The hospital reviews each request and coordinates any call for volunteers.</li>
        <li>Donors volunteer through the hospital; patients and donors do not contact one another through Lifeline.</li>
        <li>Only the minimum information needed for coordination is shared with the responsible hospital.</li>
        <li>Lifeline does not store or test blood, provide medical care, or decide donor eligibility. The hospital makes the final medical decision.</li>
      </ul>
      <p class="small muted">For urgent medical help, contact local emergency services or go to a hospital.</p>
    </section>`;
}
