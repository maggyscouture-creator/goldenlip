// netlify/functions/pesapal-order.js
// Creates a Pesapal payment order and returns the redirect URL for the customer.
// Requires env vars: PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET, PESAPAL_CALLBACK_URL (optional)

const PESAPAL_BASE = 'https://pay.pesapal.com/v3'; // production
// const PESAPAL_BASE = 'https://cybqa.pesapal.com/pesapalv3'; // sandbox, for testing

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { amount, description, email, phone, firstName, lastName } = body;

    if (!amount || !description) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'amount and description are required' })
      };
    }

    const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
    const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
    const callbackUrl = process.env.PESAPAL_CALLBACK_URL || 'https://goldenlipcosmetics.co/order-complete.html';
    const ipnUrl = process.env.PESAPAL_IPN_URL || ''; // set after registering an IPN (see notes)

    if (!consumerKey || !consumerSecret) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server is missing Pesapal credentials' })
      };
    }

    // Step 1: Get auth token
    const authResp = await fetch(`${PESAPAL_BASE}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret })
    });

    const authData = await authResp.json();

    if (!authData.token) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Failed to authenticate with Pesapal', details: authData })
      };
    }

    const token = authData.token;

    // Step 2: Register IPN if not already configured (only needed once, but safe to call)
    let notificationId = ipnUrl ? null : undefined;
    if (ipnUrl) {
      try {
        const ipnResp = await fetch(`${PESAPAL_BASE}/api/URLSetup/RegisterIPN`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'GET' })
        });
        const ipnData = await ipnResp.json();
        notificationId = ipnData.ipn_id || null;
      } catch (e) {
        notificationId = null;
      }
    }

    // Step 3: Submit order request
    const orderId = 'GL-' + Date.now();

    const orderPayload = {
      id: orderId,
      currency: 'KES',
      amount: Number(amount),
      description: description.substring(0, 100), // Pesapal limits description length
      callback_url: callbackUrl,
      notification_id: notificationId || undefined,
      billing_address: {
        email_address: email || '',
        phone_number: phone || '',
        first_name: firstName || '',
        last_name: lastName || ''
      }
    };

    const orderResp = await fetch(`${PESAPAL_BASE}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });

    const orderData = await orderResp.json();

    if (!orderData.redirect_url) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Failed to create Pesapal order', details: orderData })
      };
    }

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_url: orderData.redirect_url,
        order_tracking_id: orderData.order_tracking_id,
        merchant_reference: orderId
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', details: String(err) })
    };
  }
};
