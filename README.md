# GaadiGlow — setup guide (v5: OTP login, app-style design, your own UPI gateway option)

One website, three separate sign-ins. Each person sees only their own part:

| Portal | Who | What they see | How they get in |
|---|---|---|---|
| **Customer** | Car owners | Book (4-step wizard), track the washer live, start code, chat, pay, rate, past washes | Anyone, with mobile number + OTP |
| **Washer partner** | The wash team | Go online, jobs within 7 km, accept, start trip, verify start code, finish, earnings | Mobile number + OTP. Owner adds their number → approved automatically. Others apply and wait for approval |
| **Owner console** | Your client | Everything: live map, who booked, which washer went where, every customer, every washer, prices | Mobile number + OTP, and the account must be listed in Firestore `config/admins` |

On a phone the site opens full screen like an installed app (home with area picker, 4-step booking with car type, colour and number plate, live tracking map with the washer's route, chat, rating). The washer app uses a dark driver-style theme with a big GO button. On a laptop the two mobile apps show inside a phone frame; the owner console is a full-width dashboard.

The separation is enforced twice: the app only opens the portal the account is allowed into, **and** the Firestore security rules (`firestore.rules`) refuse any read or write outside that role, even if someone edits the app in their browser.

"GaadiGlow" is a placeholder brand. Replace it in `public/index.html`, `public/manifest.webmanifest` and `public/policies.html`.

```
public/               the website
  index.html          the whole app (all three portals)
  firebase-config.js  your Firebase keys + switches: login methods, YouPI-PG / Razorpay on/off
  policies.html       contact, pricing, terms, privacy, refunds, delivery (needed for Razorpay)
  manifest.webmanifest, sw.js, icons/   installable app, Play Store ready
functions/            server code: Razorpay order + verification, YouPI-PG checkout + webhook
payment-gateway/      kit to install your own UPI gateway (YouPI-PG) in GaadiGlow colours
firestore.rules       database security rules (the role separation)
firebase.json, .firebaserc   Firebase CLI settings
```

Open `public/index.html` in a browser now and it runs as a demo: the OTP login works, but no real SMS is sent; the code appears as a message at the top of the screen. Data stays in that browser.

---

## 0. Run it on your computer

**Tech stack:** plain HTML/CSS/JavaScript in one file (`public/index.html`, no framework, no bundler, no build step); Firebase Authentication (phone OTP), Cloud Firestore and Hosting, loaded from Google's CDN (Firebase JS SDK 10.12.2); Cloud Functions in Node.js 22 (`firebase-functions` 6, `firebase-admin` 13, `razorpay`) for online payments only. There is no root `package.json`, no test suite and no linter.

**Prerequisites**

| Tool | Needed for | Checked with |
|---|---|---|
| A modern browser | everything | any |
| Node.js 22 or newer + npm | local server, Firebase CLI, functions | Node 24.18 / npm 11 |
| Firebase CLI (`npm install -g firebase-tools`) | emulator and deploy (not for demo mode) | 15.34 |

Python is **not** required. Node 24 works for the functions even though `functions/package.json` asks for 22 (you only get a warning); the Firebase deploy runs them on Node 22.

**Demo mode (no Firebase account, nothing to configure).** `public/firebase-config.js` ships with `window.GG_FIREBASE_CONFIG = null`, so the app runs entirely in the browser: OTP codes appear on screen, data is saved in that browser only. Run these from the project folder (the one containing this README):

```powershell
cd public
npx serve . -l 3000          # then open http://localhost:3000
```

or, with the Firebase CLI (serves `public/` exactly as Hosting will; the `demo-` project name means no login or project is needed):

```powershell
firebase emulators:start --only hosting --project demo-gaadiglow    # then open http://127.0.0.1:5000
```

Stop either with Ctrl+C. Opening `public/index.html` directly also works, but the installable-app service worker only registers over `http://localhost`.

Both commands were run and served `index.html`, `firebase-config.js`, `sw.js`, the manifest, policies and icons with HTTP 200. The in-browser behaviour (login, booking, tracking) was not exercised.

**Real mode (real SMS OTP, shared database, payments).** Follow sections 1-3 below. There are no environment variables for the website: all settings live in `public/firebase-config.js` and `.firebaserc`. The only other configuration is for payments (section 7): Razorpay keys are stored with `firebase functions:secrets:set`, and YouPI-PG uses `functions/.env` (`YOUPI_API_URL`, `YOUPI_MERCHANT_ID`). Never commit real keys or `functions/.env`.

**Functions (only if you use online payment).** From the project folder:

```powershell
cd functions
npm ci            # installs exactly what package-lock.json lists (ran successfully: 261 packages)
node --check index.js; node --check youpi-core.js     # syntax check (passed)
```

**Production** is `firebase deploy --only hosting,firestore` (section 3); there is nothing to build first.

**Troubleshooting**

| Problem | Fix |
|---|---|
| `python` is not recognised | Not needed; use `npx serve` as above |
| `Unable to connect` right after starting `npx serve` | It needs a few seconds to start (the first run also downloads `serve`); retry |
| Port 3000 or 5000 already in use | `npx serve . -l 3500`, or change `emulators.hosting.port` in `firebase.json` |
| Old page keeps showing after an edit | The service worker cached it: DevTools → Application → Service Workers → Unregister, then hard refresh |
| `firebase` is not recognised | `npm install -g firebase-tools`, then reopen the terminal |
| `npm warn allow-scripts` after `npm ci` | Harmless warning from npm 11 about two dependency install scripts; the install succeeds |
| `EBADENGINE` / "Unsupported engine" for functions | Use Node 22 (or 24) |
| "Permission denied" reading data in real mode | Run `firebase deploy --only firestore`, and publish prices in the Owner console (section 5) |

---

## 1. Create the Firebase project (free)

1. https://console.firebase.google.com → **Create a project** → e.g. `gaadiglow-blr` (Analytics off).
2. **Build → Firestore Database → Create database** → location `asia-south1 (Mumbai)` → production mode.
3. **Project settings (gear) → Your apps → Web `</>`** → register → copy `firebaseConfig` into `public/firebase-config.js` (replace `null`).
4. Put the project ID in `.firebaserc` instead of `YOUR-FIREBASE-PROJECT-ID`.

## 2. Turn on mobile number + OTP login (Firebase Authentication)

Everyone signs in with their **mobile number and a 6-digit OTP** sent by SMS: customers, washers and the owner. The app shows a "Get OTP" screen, then six code boxes with a 30-second "Resend code" timer; the code is checked by Firebase, and the person stays signed in on that phone until they sign out.

1. **Upgrade to the Blaze plan** (bottom-left "Upgrade" in the Firebase console, add a card). Firebase only sends SMS on Blaze.
   Set a budget alert right away: Google Cloud console → **Billing → Budgets & alerts** → ₹500/month.
2. **Build → Authentication → Get started → Sign-in method → Phone → Enable → Save.**
3. **Authentication → Settings → SMS region policy → Allow → India** only. This blocks SMS fraud from other countries, which is the main way phone-login bills grow.
4. **Phone numbers for testing** (on the Phone provider page): add e.g. `+91 99999 00001` with code `123456`, plus one per role you want to try (`+91 99999 00002` for a washer, `+91 99999 00003` for the owner). These never send a real SMS and cost nothing.
5. **Authentication → Settings → Authorized domains**: your `.web.app` and `.firebaseapp.com` addresses are already there. Add your own domain after Step 6.

Switches in `public/firebase-config.js`:

```js
window.GG_AUTH = { phone: true, google: false };   // default: OTP only
// window.GG_AUTH = { phone: true, google: true };  // also show "Continue with Google"
```

Cost: each "Get OTP" or "Resend" sends one SMS. Firebase bills SMS to India per message after a small daily free allowance (about US$0.07 ≈ ₹6.6 each when this guide was written; check the current rate on the Identity Platform pricing page). People stay signed in, so a regular customer needs a new OTP only after signing out or changing phones.

An invisible reCAPTCHA check runs before each SMS (Firebase's protection against bots). Very occasionally it shows a picture puzzle; that is normal.

## 3. Deploy the website and the security rules

On your laptop (Node.js 22):

```bash
npm install -g firebase-tools
firebase login
cd gaadiglow                                  # this folder
firebase deploy --only hosting,firestore
```

Live at `https://YOUR-PROJECT-ID.web.app`. Always deploy `firestore` too: the rules are what keep the three roles apart.

## 4. Make your client the owner

1. On his phone, open the live site → **Business owner** → sign in with his mobile number and OTP.
2. It says "This account is not an owner" and shows an ID → **Copy ID**.
3. Firebase console → Firestore → **Start collection** `config` → document ID `admins` → field `uids`, type **array** → add the ID → Save.
4. Reload. The console opens. Add your own ID to the same array if you need access for support.

## 5. First things in the Owner console

1. **Publish prices.** The console shows "Prices are not published yet" → **Publish the default prices** (or edit them under **Prices & rules** → Save). Until this is done, customers cannot book, because the rules check every booking's price against this list.
2. **Add the washers.** **Washers → Add a washer to the team**: name, mobile number, area, vehicle → **Add washer**. When that person opens **Washer partner** and signs in with that number and the OTP, they are approved straight away.
   - Anyone else who signs in to the partner app can apply; they appear under **Needs attention** → **Approve**.
   - If you also switch on Google login, you can add a washer by Gmail instead.
3. **Pause / Remove** a washer any time. A paused washer can no longer see or accept jobs.

What the owner sees: KPIs (today's revenue and the business's share, bookings, washers online, waiting jobs), a live map of washers and open bookings, a live activity feed ("Ravi accepted GG-1042 for Priya", "Ravi left for Koramangala", "started washing", "finished · ₹649 · ★★★★★"), a customer list (mobile, usual area, bookings, total spent, wash in progress), a washer list (who is on which job right now, washes, rating, earnings), and every booking with full details, timeline, reassign and cancel.

### How the data is protected

| Data | Customer | Washer | Owner |
|---|---|---|---|
| Their own bookings | ✓ | — | ✓ all |
| Open requests (area, car, package, price — no address) | — | ✓ approved only | ✓ |
| Customer's address and mobile (`bookings/{id}/private/details`) | own | only after accepting that job | ✓ |
| 4-digit start code (`bookings/{id}/private/otp`) | own | never; the rules check the code he types | ✓ |
| Customer list, washer mobiles, invites, prices editing | — | — | ✓ |

Other rules: a customer can only book at the listed price, can cancel only before the trip starts, and can only rate after the wash. A washer can only claim a job nobody else has, can only move his own jobs forward one step at a time, and cannot start a wash without the customer's code. Nobody except the server can mark a booking paid.

## 6. Domain

Buy a `.in` (e.g. `gaadiglow.in`) at Hostinger, GoDaddy India or BigRock, in the client's name.
Firebase console → **Hosting → Add custom domain** → add the DNS records it shows at your registrar. SSL is automatic. Then add the domain under **Authentication → Authorized domains**.

## 7. Online payment (optional): your own UPI gateway or Razorpay

Customers can always pay cash or UPI to the washer. For "Pay now" inside the app there are two options; switch on one of them:

| | **YouPI-PG** (self-hosted UPI, `payment-gateway/`) | **Razorpay** (below) |
|---|---|---|
| Fee per payment | ₹0; money goes straight to the client's bank by UPI | 2% + GST |
| Payment methods | UPI only | UPI, cards, netbanking, wallets |
| You must run | A server 24×7, an Android phone with the bank SIM, a spare WhatsApp number | Nothing |
| Status | Experimental open project; its licence terms must be confirmed with the authors; suggests ≤20 payments/day per UPI ID | Licensed payment aggregator |
| Customer experience | GaadiGlow-styled checkout sheet inside the app; one WhatsApp code the first time | Razorpay checkout |
| Switch | `window.GG_YOUPI = { portalUrl: 'https://pay.gaadiglow.in' }` | `window.GG_RAZORPAY = true` |

If both are set, YouPI-PG is used. Full YouPI-PG setup, costs and caveats: **`payment-gateway/README.md`**. Both mark a booking **Paid online** only from the server (a signed webhook or a verified signature), never from the phone.

### Razorpay

1. Client signs up at https://dashboard.razorpay.com/signup with his PAN, ID and bank account.
2. Activation asks for the live website and links to: Contact us, Pricing, Terms, Privacy, Cancellation & refunds, Shipping (service delivery), plus a sample invoice. `public/policies.html` has all six as a template. **Fill in the client's business name, address, email and phone, and have him review the wording, before submitting.**
3. Dashboard (start in **Test mode**): **Account & Settings → API Keys → Generate key**. Set **Payment capture → Automatic**.
4. Upgrade Firebase to **Blaze** (Cloud Functions need it; 2 million calls/month free).
5. Store the keys as secrets and deploy the functions:
   ```bash
   cd functions && npm install && cd ..
   firebase functions:secrets:set RAZORPAY_KEY_ID
   firebase functions:secrets:set RAZORPAY_KEY_SECRET
   firebase deploy --only functions:createRazorpayOrder,functions:verifyRazorpayPayment
   ```
   (Deploy only these two. A plain `firebase deploy --only functions` also deploys the YouPI-PG functions and asks for their secret.)
6. In `public/firebase-config.js` set `window.GG_RAZORPAY = true;` → `firebase deploy --only hosting`.
7. Test with Razorpay test cards/UPI. Then generate **Live** keys, set the secrets again, redeploy functions.

How it works: the phone asks `createRazorpayOrder` for an order (the amount comes from the booking in the database, never from the phone) → Razorpay checkout → `verifyRazorpayPayment` checks the signature with the secret key → booking marked **Paid online**.
Razorpay fee: 2% + 18% GST on that fee (2.36% of the payment), no setup fee.

## 8. Google Play Store

1. https://www.pwabuilder.com → enter your live URL → **Package for stores → Android** → download.
2. Keep the signing key from that zip safe; every update needs it.
3. Put its `assetlinks.json` at `public/.well-known/assetlinks.json` → `firebase deploy --only hosting` (hides the browser bar).
4. https://play.google.com/console/signup → US$25 one time → identity verification, in the client's name.
5. Upload the `.aab` to **Testing → Closed testing**. New personal accounts need **12 testers opted in for 14 days in a row** before production.
6. Store listing, screenshots, content rating, data-safety form, privacy policy URL (`/policies.html#privacy`) → apply for production.

Apple App Store needs US$99/year plus a Mac; iPhone users can use Safari → Share → **Add to Home Screen** for free.

## Phase 2 ideas (not included)
Push notifications for new nearby jobs, live GPS of the washer, GST invoices, a Razorpay webhook, refunds from the console, limiting start-code attempts with a Cloud Function.
