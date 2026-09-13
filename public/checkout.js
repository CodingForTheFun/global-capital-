const state = document.getElementById('checkoutState');
const unavailable = document.getElementById('checkoutUnavailable');
const payArea = document.getElementById('payArea');
const subscribeButton = document.getElementById('subscribeButton');
const productName = document.getElementById('productName');
const price = document.getElementById('price');
const cadence = document.getElementById('billingCadence');

let csrfToken = '';

function message(text, type = '') {
  state.replaceChildren();
  if (!text) return;
  const node = document.createElement('div');
  node.className = `checkout-state ${type}`.trim();
  node.textContent = String(text);
  state.appendChild(node);
}

function cadenceText(config) {
  const count = Number(config.intervalCount) || 1;
  const unit = String(config.intervalUnit || '').toLowerCase();
  if (!unit) return 'Recurring subscription';
  if (count === 1) return `Billed every ${unit}`;
  return `Billed every ${count} ${unit}s`;
}

async function account() {
  const response = await fetch('/api/account/me', { cache: 'no-store', credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.authenticated) return null;
  csrfToken = String(data.csrfToken || '');
  return data;
}

async function billingConfig() {
  const response = await fetch('/api/payments/config', { cache: 'no-store', credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Billing configuration is unavailable.');
  return data;
}

async function createSubscription() {
  const response = await fetch('/api/payments/create-subscription', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrfToken },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.approvalUrl) throw new Error(data.message || 'Could not start the subscription.');
  return data;
}

async function confirmSubscription(subscriptionId) {
  const response = await fetch('/api/payments/confirm-subscription', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ subscriptionId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Subscription could not be verified.');
  return data;
}

async function boot() {
  try {
    const signedIn = await account();
    if (!signedIn) {
      unavailable.textContent = 'Sign in to Oblige Props before joining Founding Pro. Billing never starts for an anonymous session.';
      return;
    }

    const config = await billingConfig();
    productName.textContent = config.productName || 'Oblige Props Founding Pro';
    price.textContent = config.price ? `${config.currency || 'USD'} $${config.price}` : 'Not open';
    cadence.textContent = config.price ? cadenceText(config) : 'Recurring subscription';

    const query = new URLSearchParams(location.search);
    if (query.get('billing') === 'cancel') message('Subscription setup was canceled. No access change was made.');

    const returnedSubscription = query.get('subscription_id');
    if (returnedSubscription) {
      message('Verifying the active PayPal subscription…');
      try {
        const confirmed = await confirmSubscription(returnedSubscription);
        message('Founding Pro is active. Your access was verified directly with PayPal.', 'success');
        window.history.replaceState({}, '', '/checkout?billing=success');
        if (confirmed?.entitlement?.plan === 'pro') unavailable.hidden = true;
      } catch (error) {
        message(error.message || 'PayPal has not activated this subscription yet.', 'error');
      }
    }

    if (!config.enabled) {
      unavailable.hidden = false;
      unavailable.textContent = config.reason === 'PLAN_UNVERIFIED'
        ? 'Founding Pro checkout is paused because the recurring PayPal plan could not be verified.'
        : 'Founding Pro billing is not open yet. No payment can be started from this page.';
      return;
    }

    unavailable.hidden = true;
    payArea.hidden = false;
    if (config.environment === 'sandbox') {
      message('Sandbox billing is configured. Do not treat sandbox activity as live revenue.');
    }

    subscribeButton.addEventListener('click', async () => {
      subscribeButton.disabled = true;
      message('Opening secure PayPal subscription approval…');
      try {
        const subscription = await createSubscription();
        location.assign(subscription.approvalUrl);
      } catch (error) {
        message(error.message || 'Subscription setup could not start.', 'error');
        subscribeButton.disabled = false;
      }
    });
  } catch (error) {
    unavailable.hidden = false;
    unavailable.textContent = error.message || 'Checkout could not initialize.';
    message(error.message || 'Checkout could not initialize.', 'error');
  }
}

boot();
