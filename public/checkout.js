const state = document.getElementById('checkoutState');
const unavailable = document.getElementById('checkoutUnavailable');
const payArea = document.getElementById('payArea');
const cardArea = document.getElementById('cardArea');
const cardSubmit = document.getElementById('cardSubmit');

function message(text, type = '') {
  state.innerHTML = text ? `<div class="checkout-state ${type}">${String(text).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]))}</div>` : '';
}

async function createOrder() {
  const response = await fetch('/api/payments/create-order', { method:'POST', credentials:'same-origin' });
  const data = await response.json();
  if (!response.ok || !data.id) throw new Error(data.message || 'Could not create PayPal order.');
  return data.id;
}

async function captureOrder(orderId) {
  const response = await fetch('/api/payments/capture-order', {
    method:'POST',
    credentials:'same-origin',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ orderId }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || 'Payment could not be captured.');
  message('Payment completed successfully. Your PayPal merchant account received the captured order.', 'success');
  return data;
}

function loadPayPalSdk(config) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-autoprop-paypal]');
    if (existing) {
      if (window.paypal) return resolve(window.paypal);
      existing.addEventListener('load', () => resolve(window.paypal), { once:true });
      existing.addEventListener('error', () => reject(new Error('PayPal checkout failed to load.')), { once:true });
      return;
    }
    const script = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': config.clientId,
      currency: config.currency,
      intent: 'capture',
      components: 'buttons,card-fields',
      'enable-funding': 'venmo,paylater',
    });
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.dataset.autopropPaypal = 'true';
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error('PayPal checkout failed to load.'));
    document.head.appendChild(script);
  });
}

async function boot() {
  try {
    const response = await fetch('/api/payments/config', { cache:'no-store', credentials:'same-origin' });
    const config = await response.json();
    document.getElementById('productName').textContent = config.productName || 'AutoProp Scout Pro Access';
    document.getElementById('price').textContent = config.price ? `${config.currency || 'USD'} $${config.price}` : 'Not set';
    if (!config.enabled) {
      unavailable.textContent = 'Checkout code is installed, but live charging is disabled until the owner adds a PayPal Business client ID, client secret, and price on the server.';
      return;
    }

    unavailable.hidden = true;
    payArea.hidden = false;
    const paypal = await loadPayPalSdk(config);
    if (!paypal) throw new Error('PayPal SDK did not initialize.');

    if (paypal.Buttons) {
      await paypal.Buttons({
        style: { layout:'vertical', shape:'rect', label:'paypal' },
        createOrder,
        onApprove: async (data) => {
          try { message('Capturing PayPal payment…'); await captureOrder(data.orderID); }
          catch (error) { message(error.message || 'Payment capture failed.', 'error'); }
        },
        onCancel: () => message('Checkout canceled.'),
        onError: (error) => message(error?.message || 'PayPal checkout failed.', 'error'),
      }).render('#paypal-button-container');
    }

    if (config.cardFieldsRequested && paypal.CardFields) {
      const cardFields = paypal.CardFields({
        createOrder,
        onApprove: async (data) => {
          try { message('Capturing card payment through PayPal…'); await captureOrder(data.orderID); }
          catch (error) { message(error.message || 'Card payment capture failed.', 'error'); }
        },
        onError: (error) => message(error?.message || 'Card payment failed.', 'error'),
      });
      if (cardFields?.isEligible?.()) {
        cardArea.hidden = false;
        await cardFields.NameField().render('#card-name-field-container');
        await cardFields.NumberField().render('#card-number-field-container');
        await cardFields.ExpiryField().render('#card-expiry-field-container');
        await cardFields.CVVField().render('#card-cvv-field-container');
        cardSubmit.addEventListener('click', async () => {
          cardSubmit.disabled = true;
          message('Submitting card securely through PayPal…');
          try { await cardFields.submit(); }
          catch (error) { message(error?.message || 'Card submission failed.', 'error'); }
          finally { cardSubmit.disabled = false; }
        });
      }
    }
  } catch (error) {
    unavailable.textContent = error.message || 'Checkout could not initialize.';
    message(error.message || 'Checkout could not initialize.', 'error');
  }
}

boot();
