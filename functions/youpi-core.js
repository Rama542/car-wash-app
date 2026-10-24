// GaadiGlow ↔ YouPI-PG (self-hosted UPI gateway): the parts that do not depend on Firebase,
// so they can be tested against a local gateway with plain Node.
const crypto = require('crypto');

const rupees = n => (Math.round(Number(n) * 100) / 100).toFixed(2);
function fail(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }

/**
 * Asks the gateway for a UPI checkout for one booking.
 * The amount always comes from the booking stored in the database, never from the phone.
 */
async function createYoupiPayment({apiUrl, merchantId, merchantKey, bookingId, booking, customer, fetchImpl = fetch}) {
  if (!apiUrl || !merchantId || !merchantKey) throw fail('failed-precondition', 'UPI payments are not set up yet.');
  const amountPaise = Math.round(Number(booking.price) * 100);
  if (!(amountPaise >= 100 && amountPaise <= 10000000)) throw fail('failed-precondition', 'This booking has no valid price.');
  const body = {
    orderId: bookingId,
    amount: rupees(booking.price),
    currency: 'INR',
    metadata: {bookingId, code: booking.code || '', app: 'gaadiglow'}
  };
  if (customer && /^[6-9]\d{9}$/.test(customer.phone || '')) body.customer = {name: customer.name || '', mobileNumber: customer.phone};
  let res;
  try {
    res = await fetchImpl(String(apiUrl).replace(/\/+$/, '') + '/api/v1/payments', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Merchant-Id': merchantId, 'X-Merchant-Key': merchantKey, 'Idempotency-Key': 'gg-' + bookingId},
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw fail('unavailable', 'The UPI payment server is not reachable right now. Please pay by cash or UPI to the washer.');
  }
  const data = await res.json().catch(() => ({}));
  // The booking already has an open checkout that the customer's phone is tied to (for example the
  // app was closed while the checkout was showing). Hand that checkout back instead of failing; the
  // gateway's own page checks that it is opened on the same phone.
  const open = data.activeSession || {};
  const openId = data.session_id || open.paymentId;
  if (res.status === 409 && (data.code === 'DEVICE_SESSION_MISMATCH' || data.error === 'DUPLICATE_SESSION_DETECTED') && openId) {
    if (open.amount != null && Math.round(Number(open.amount) * 100) !== amountPaise) throw fail('internal', 'The payment server returned a different amount.');
    return {paymentId: String(openId), checkoutUrl: null, status: 'ACTIVE', amountPaise, resumed: true};
  }
  if (!res.ok || !data.checkoutUrl) {
    const msg = data.message || data.error || ('Payment server error ' + res.status);
    throw fail(res.status === 409 ? 'already-exists' : 'unavailable', msg, {gateway: data});
  }
  if (Number(data.amountPaise) && Number(data.amountPaise) !== amountPaise) throw fail('internal', 'The payment server returned a different amount.');
  return {paymentId: data.paymentId, checkoutUrl: data.checkoutUrl, status: data.status, amountPaise};
}

/** X-Gateway-Signature: sha256=HMAC_SHA256(secret, raw request bytes) */
function verifyYoupiSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = String(signature || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/**
 * Handles one webhook delivery. Returns {status, body} for the HTTP reply.
 * store.markPaidOnce({...}) must atomically: ignore a repeated deliveryId, check the booking
 * exists, is unpaid and costs exactly amountPaise, then mark it paid. It returns a short result string.
 */
async function handleYoupiWebhook({rawBody, headers, secret, store, now = Date.now()}) {
  const h = k => headers[k] || headers[k.toLowerCase()] || '';
  if (!verifyYoupiSignature(rawBody, h('x-gateway-signature'), secret)) return {status: 401, body: {error: 'Invalid signature'}};
  let p;
  try { p = JSON.parse(rawBody.toString('utf8')); } catch (e) { return {status: 400, body: {error: 'Body is not JSON'}}; }
  const event = p.event || h('x-gateway-event');
  // Only a verified UPI credit means money arrived. COD / counter "SUCCESS" events are not payments.
  if (event !== 'SUCCESS') return {status: 200, body: {received: true, ignored: 'event ' + event}};
  if (p.method && p.method !== 'UPI') return {status: 200, body: {received: true, ignored: 'method ' + p.method}};
  const bookingId = String(p.orderId || '').replace(/-R\d+$/, '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(bookingId)) return {status: 200, body: {received: true, ignored: 'unknown order'}};
  const amountPaise = Number(p.amountPaise != null ? p.amountPaise : Math.round(Number(p.amount) * 100));
  const deliveryId = String(p.deliveryId || h('x-gateway-delivery-id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  const result = await store.markPaidOnce({
    bookingId, deliveryId, amountPaise, utr: String(p.utr || '').slice(0, 40), paymentId: String(p.paymentId || '').slice(0, 80), paidAt: now
  });
  return {status: 200, body: {received: true, result}};
}

module.exports = {createYoupiPayment, verifyYoupiSignature, handleYoupiWebhook, rupees};
