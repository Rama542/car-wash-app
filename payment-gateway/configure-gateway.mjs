#!/usr/bin/env node
// Sets GaadiGlow's business details, branding and webhook on a running YouPI-PG gateway.
// Run on the gateway server after `npm start`:
//
//   YOUPI_API_URL=http://127.0.0.1:6100 \
//   ADMIN_API_TOKEN=... (from the gateway's .env or data/.secrets/admin_api_token) \
//   UPI_ID=gaadiglow@okhdfcbank PAYEE_NAME="GaadiGlow" \
//   WEBHOOK_URL=https://asia-south1-YOUR-PROJECT.cloudfunctions.net/youpiWebhook \
//   SITE_URL=https://gaadiglow.in \
//   node configure-gateway.mjs
//
// It prints the merchant ID and key to store as Firebase secrets (YOUPI_MERCHANT_ID, YOUPI_MERCHANT_KEY).
const env = process.env;
const api = (env.YOUPI_API_URL || 'http://127.0.0.1:6100').replace(/\/+$/, '');
const need = ['ADMIN_API_TOKEN', 'UPI_ID', 'WEBHOOK_URL'];
const missing = need.filter(k => !env[k]);
if (missing.length) { console.error('Missing: ' + missing.join(', ') + '\nSee the comment at the top of this file.'); process.exit(1); }
const site = (env.SITE_URL || '').replace(/\/+$/, '');
const body = {
  businessName: env.BUSINESS_NAME || 'GaadiGlow',
  upiId: env.UPI_ID,
  payeeName: env.PAYEE_NAME || env.BUSINESS_NAME || 'GaadiGlow',
  webhookUrl: env.WEBHOOK_URL,
  enabledPaymentMethods: ['UPI'],
  supportMobiles: env.SUPPORT_MOBILE ? [env.SUPPORT_MOBILE] : undefined,
  supportEmails: env.SUPPORT_EMAIL ? [env.SUPPORT_EMAIL] : undefined,
  privacyPolicyUrl: site.startsWith('https://') ? site + '/policies.html#privacy' : undefined,
  branding: {
    appName: 'GaadiGlow',
    primaryColor: '#1557FF',
    headerTheme: 'gradient',
    // Plain facts only: replaces the template's "N orders this month" banner text.
    subbannerText: 'Pay GaadiGlow directly by UPI · no extra charge',
    sidebarNotice: 'Pay GaadiGlow directly by UPI · no extra charge',
    footerGuarantee: 'Your payment goes straight to GaadiGlow\'s bank account by UPI.',
    termsUrl: site.startsWith('https://') ? site + '/policies.html#terms' : undefined,
    trustBadgeText: 'Car wash · Bengaluru',
    hidePoweredBy: true
  }
};
const res = await fetch(api + '/api/v1/admin/all-settings', {
  method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + env.ADMIN_API_TOKEN}, body: JSON.stringify(body)
});
const data = await res.json().catch(() => ({}));
if (!res.ok) { console.error('Gateway refused the settings (' + res.status + '):', data.error || data); process.exit(1); }
console.log('Saved. Business:', data.businessName || body.businessName, '| UPI:', data.upiId || body.upiId, '| Webhook:', data.webhookUrl);
console.log('\nNow store these two values as Firebase secrets (see README):');
console.log('  YOUPI_MERCHANT_ID  =', data.merchantId);
console.log('  YOUPI_MERCHANT_KEY =', data.webhookSecret || '(open Merchant Admin → Settings → Webhook secret)');
console.log('\nKeep the key private: anyone with it can create payment requests and fake webhooks for GaadiGlow.');
