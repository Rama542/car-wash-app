// GaadiGlow Cloud Functions: online payments through Razorpay or the self-hosted YouPI-PG UPI gateway.
// The secret key never reaches the phone. The amount is read from the booking in
// Firestore (whose price the rules lock to the owner's price list), so a customer
// cannot change what they pay.
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {setGlobalOptions} = require('firebase-functions/v2');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');

admin.initializeApp();
setGlobalOptions({region: 'asia-south1', maxInstances: 5});

const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');

async function loadOwnBooking(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
  const bookingId = String((req.data && req.data.bookingId) || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(bookingId)) throw new HttpsError('invalid-argument', 'Missing booking.');
  const ref = admin.firestore().doc('bookings/' + bookingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const b = snap.data();
  if (b.customerId !== req.auth.uid) throw new HttpsError('permission-denied', 'This is not your booking.');
  return {ref, b};
}

// 1) Create a Razorpay order for the booking's price.
exports.createRazorpayOrder = onCall({secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET]}, async (req) => {
  const {ref, b} = await loadOwnBooking(req);
  if (b.paid) throw new HttpsError('failed-precondition', 'This booking is already paid.');
  if (b.status === 'cancelled') throw new HttpsError('failed-precondition', 'This booking was cancelled.');
  // The security rules already force price == settings/pricing.priceTable[pkg][carType] when the
  // booking is created, and nobody but the owner can change it later. Check it once more here anyway.
  const settings = (await admin.firestore().doc('settings/pricing').get()).data() || {};
  const listed = settings.priceTable && settings.priceTable[b.pkg] && settings.priceTable[b.pkg][b.carType];
  if (listed == null) throw new HttpsError('failed-precondition', 'This package is no longer on the price list.');
  const amount = Math.round(Number(b.price) * 100); // rupees → paise
  if (!(amount >= 100 && amount <= 10000000)) throw new HttpsError('failed-precondition', 'This booking has no valid price.');

  const rzp = new Razorpay({key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value()});
  const order = await rzp.orders.create({
    amount, currency: 'INR', receipt: String(b.code || ref.id).slice(0, 40),
    notes: {bookingId: ref.id, area: String(b.area || '')}
  });
  await ref.update({razorpayOrderId: order.id});
  return {orderId: order.id, amount, keyId: RAZORPAY_KEY_ID.value()};
});

// 2) Verify the signature Razorpay returns, then mark the booking paid.
exports.verifyRazorpayPayment = onCall({secrets: [RAZORPAY_KEY_SECRET]}, async (req) => {
  const {ref, b} = await loadOwnBooking(req);
  const orderId = String(req.data.razorpay_order_id || '');
  const paymentId = String(req.data.razorpay_payment_id || '');
  const signature = String(req.data.razorpay_signature || '');
  if (!orderId || orderId !== b.razorpayOrderId) throw new HttpsError('failed-precondition', 'Order does not match this booking.');

  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET.value()).update(orderId + '|' + paymentId).digest('hex');
  const ok = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!ok) throw new HttpsError('permission-denied', 'Payment could not be verified.');

  await ref.update({paid: true, paymentId, paidAt: Date.now(), pay: 'online'});
  return {ok: true};
});

// ---------------------------------------------------------------------------
// UPI through the self-hosted YouPI-PG gateway (see ../payment-gateway/README.md).
// Settings: functions/.env → YOUPI_API_URL, YOUPI_MERCHANT_ID
// Secret:   firebase functions:secrets:set YOUPI_MERCHANT_KEY
// ---------------------------------------------------------------------------
const {onRequest} = require('firebase-functions/v2/https');
const {defineString} = require('firebase-functions/params');
const youpi = require('./youpi-core');

const YOUPI_API_URL = defineString('YOUPI_API_URL', {default: ''});
const YOUPI_MERCHANT_ID = defineString('YOUPI_MERCHANT_ID', {default: ''});
const YOUPI_MERCHANT_KEY = defineSecret('YOUPI_MERCHANT_KEY');

// 3) The app asks for a UPI checkout; the gateway's page then opens inside the app.
exports.createYoupiPayment = onCall({secrets: [YOUPI_MERCHANT_KEY]}, async (req) => {
  const {ref, b} = await loadOwnBooking(req);
  if (b.paid) throw new HttpsError('failed-precondition', 'This booking is already paid.');
  if (b.status === 'cancelled') throw new HttpsError('failed-precondition', 'This booking was cancelled.');
  const settings = (await admin.firestore().doc('settings/pricing').get()).data() || {};
  const listed = settings.priceTable && settings.priceTable[b.pkg] && settings.priceTable[b.pkg][b.carType];
  if (listed == null) throw new HttpsError('failed-precondition', 'This package is no longer on the price list.');
  try {
    // No customer is attached on purpose: the gateway would then accept only that exact number in its
    // WhatsApp check, and people whose WhatsApp is on another number could not pay. Who owns the
    // booking was already checked above; the bank's credit alert proves the payment.
    const r = await youpi.createYoupiPayment({
      apiUrl: YOUPI_API_URL.value(), merchantId: YOUPI_MERCHANT_ID.value(), merchantKey: YOUPI_MERCHANT_KEY.value(),
      bookingId: ref.id, booking: b, customer: null
    });
    if (r.checkoutUrl) await ref.update({youpiPaymentId: r.paymentId, youpiCheckoutUrl: r.checkoutUrl});
    // r.resumed: an open checkout for this booking already exists; send the phone back to it.
    const checkoutUrl = r.checkoutUrl || (b.youpiPaymentId === r.paymentId && b.youpiCheckoutUrl) || null;
    return {checkoutUrl, paymentId: r.paymentId, resumed: !!r.resumed};
  } catch (e) {
    console.error('createYoupiPayment', e.message, e.gateway || '');
    const code = ['failed-precondition', 'already-exists', 'unavailable'].includes(e.code) ? e.code : 'internal';
    throw new HttpsError(code, e.message);
  }
});

// 4) The gateway calls this when its bank-alert observers confirm the UPI credit.
//    This is the only thing that marks a booking "Paid online" (not the browser).
exports.youpiWebhook = onRequest({secrets: [YOUPI_MERCHANT_KEY], cors: false}, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const db = admin.firestore();
  const store = {
    markPaidOnce: ({bookingId, deliveryId, amountPaise, utr, paymentId, paidAt}) => db.runTransaction(async (t) => {
      const ref = db.doc('bookings/' + bookingId);
      const evRef = deliveryId ? db.doc('paymentEvents/' + deliveryId) : null;
      const snap = await t.get(ref);
      const ev = evRef ? await t.get(evRef) : null;
      if (ev && ev.exists) return 'duplicate';
      const log = (result) => { if (evRef) t.set(evRef, {bookingId, utr, amountPaise, paymentId, result, at: paidAt}); return result; };
      if (!snap.exists) return log('unknown-booking');
      const b = snap.data();
      if (b.paid) return log('already-paid');
      if (Math.round(Number(b.price) * 100) !== amountPaise) return log('amount-mismatch');
      t.update(ref, {paid: true, pay: 'online', gateway: 'youpi', paymentId, utr, paidAt});
      return log('marked-paid');
    })
  };
  try {
    const out = await youpi.handleYoupiWebhook({rawBody: req.rawBody, headers: req.headers, secret: YOUPI_MERCHANT_KEY.value(), store});
    if (out.body && out.body.result && out.body.result !== 'marked-paid') console.warn('youpiWebhook', out.body.result);
    res.status(out.status).json(out.body);
  } catch (e) {
    console.error('youpiWebhook', e);
    res.status(500).json({error: 'Could not record the payment'}); // the gateway retries with backoff
  }
});
