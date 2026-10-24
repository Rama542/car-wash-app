# GaadiGlow UPI payments with YouPI-PG (self-hosted)

This folder connects GaadiGlow to **YouPI-PG** (https://github.com/youpi-pg/YouPI-PG), a gateway you run on your own server. Customers pay by UPI straight into the client's bank account, so there is **no per-payment fee**. The gateway confirms each payment by reading the bank's credit alert (SMS on an Android phone, and/or the bank's email in Gmail).

```
Customer taps "Pay ₹549 by UPI" in the app
  → Cloud Function createYoupiPayment asks the gateway for a checkout (amount read from the booking, never from the phone)
  → the gateway's checkout opens as a sheet inside the app, in GaadiGlow colours
  → customer confirms their WhatsApp number once, scans the QR / taps their UPI app, pays
  → the bank sends its credit alert → the observer phone/Gmail passes it to the gateway
  → the gateway calls Cloud Function youpiWebhook (signed) → booking marked "Paid ₹549 online · UPI ref …"
```

The app only shows "Paid" after the signed webhook arrives. What the checkout says in the browser only changes the screen to "Confirming your UPI payment…".

## Read this before choosing it

- **It is an experimental project.** Its own README says it is a research and learning project, not a certified, bank-approved or NPCI-approved gateway, and asks users to keep to **20 or fewer payments a day per receiving account** unless they have checked their bank's and UPI app's rules. GaadiGlow's volume fits that at the start, but this is a limit to watch.
- **Licence.** The project's `package.json` says `"license": "Commercial"` and its README points to a `LICENSE` file that is not in the repository. **Before using it for a paying client, ask the authors for the terms** (open an issue on the GitHub page). That is why this folder does **not** include the gateway's code: `setup.sh` downloads it from GitHub.
- **You run a server 24×7.** If the gateway, its phone or its internet is down, customers cannot pay online (cash and UPI-to-the-washer still work, and the app says so).
- **Customers verify a number twice.** The gateway asks for a 6-digit code on WhatsApp the first time someone pays (their name and email too), even though they already logged in to GaadiGlow with an SMS OTP. It remembers them on that phone afterwards. They can use whichever number their WhatsApp is on: GaadiGlow deliberately does not send the login number to the gateway, because the gateway would then refuse any other number.
- **WhatsApp codes are sent from a WhatsApp account you link** (the gateway uses an unofficial WhatsApp Web connection). WhatsApp can block numbers it sees as automated, so use a **separate SIM**, not the owner's personal number.
- **One customer at a time per UPI ID.** The gateway handles one checkout per receiving UPI ID at a time (so it can match each credit to the right booking); others wait their turn for a few minutes at most. Fine for one washing business; add more receiving accounts in merchant admin if it gets busy.
- **Keep Razorpay as the fallback** if the client needs cards, refunds through a dashboard, or a gateway with formal approval. The app supports either one: `GG_YOUPI` set → YouPI is used; otherwise `GG_RAZORPAY` → Razorpay.

## What you need

| Item | Why | Typical cost |
|---|---|---|
| A small Linux server (1–2 GB RAM VPS), or an always-on PC | Runs the gateway (Node.js 24) | A few hundred ₹/month for a VPS; check current prices |
| The domain on **Cloudflare** (free plan) | Cloudflare Tunnel gives the gateway `https://pay.gaadiglow.in` without opening ports | ₹0 |
| An Android phone with the **SIM registered to the receiving bank account** | Reads the bank's credit SMS and forwards it to the gateway (YouPI-PG Android observer app) | An old phone is fine; must stay on, charged and online |
| Gmail with the bank's email alerts switched on (recommended) | Second confirmation source. With both SMS and Gmail working the checkout shows **"Server Is Working"** (green); with one it shows "UPI Server Busy" (yellow); with none it tells customers to pay by cash (red) | ₹0 |
| A spare WhatsApp number | Sends customers their checkout code | A prepaid SIM |
| A UPI ID for the client's business bank account | Where the money goes | ₹0 |

## Files in this folder

```
setup.sh                    downloads YouPI-PG (tested version), installs it, writes .env with new secrets,
                            creates the database and applies the GaadiGlow look
gateway.env.example         the gateway settings for GaadiGlow (setup.sh copies it to .env)
apply-gaadiglow-theme.mjs   GaadiGlow colours, font, logo and wording for the checkout (setup.sh runs it)
gaadiglow-theme.css         the stylesheet it installs
configure-gateway.mjs       sets business name, UPI ID, branding and the webhook; prints the merchant ID and key
```

The app side is already done in this release: `functions/youpi-core.js`, the two functions `createYoupiPayment` and `youpiWebhook` in `functions/index.js`, and the "Pay by UPI" button, checkout sheet and confirming/paid states in `public/index.html`.

---

## Step 1: Server and Node.js

On an Ubuntu VPS (as a normal user with sudo):

```bash
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v        # v24.x
```

Copy this `payment-gateway` folder to the server (for example with `scp -r payment-gateway user@server:~/`).

## Step 2: Install the gateway

```bash
cd ~/payment-gateway
bash setup.sh            # installs into ~/youpi-pg
```

It stays on the version GaadiGlow was tested with (`d7b0741`). To try the newest version instead: `YOUPI_LATEST=1 bash setup.sh`, then test everything again.

## Step 3: Edit the settings

```bash
nano ~/youpi-pg/.env
```

Fix every line marked `EDIT`:

- `CLOUDFLARE_DOMAIN`, `BASE_*_URL`: the client's domain. The gateway uses four addresses: `pay.` (checkout), `pay-api.` (API), `pay-admin.` (merchant admin), `pay-gmail.` (Gmail sign-in).
- `CHECKOUT_FRAME_ANCESTORS`: **every address the app is opened from**, separated by spaces: `https://gaadiglow.in https://www.gaadiglow.in https://YOUR-PROJECT.web.app https://YOUR-PROJECT.firebaseapp.com`. If one is missing, the checkout sheet stays blank on that address.
- `DEFAULT_SUPPORT_EMAIL`.
- Gmail lines only if you set up the Gmail observer (Step 6).

`ADMIN_API_TOKEN` in this file is the password for merchant admin. Keep a copy somewhere safe (a password manager).

## Step 4: Start it and put it online

Start it once by hand to see that it runs:

```bash
cd ~/youpi-pg && npm start
```

Keep it running after reboots with systemd (`sudo nano /etc/systemd/system/youpi-pg.service`):

```ini
[Unit]
Description=YouPI-PG gateway for GaadiGlow
After=network-online.target

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/youpi-pg
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now youpi-pg
```

**Cloudflare Tunnel** (Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create tunnel → install the connector on the server with the command it shows), then add these public hostnames:

| Public hostname | Service |
|---|---|
| `pay.gaadiglow.in` | `http://localhost:7000` |
| `pay-api.gaadiglow.in` | `http://localhost:6100` |
| `pay-admin.gaadiglow.in` | `http://localhost:6001` |
| `pay-gmail.gaadiglow.in` | `http://localhost:6003` |

Protect `pay-admin.gaadiglow.in` with **Zero Trust → Access → Applications** (allow only the owner's and your email). Merchant admin also asks for the admin token, but it should not be open to the internet.

Check: `https://pay.gaadiglow.in/youpi.js` shows JavaScript, and `https://pay-api.gaadiglow.in/health` says `UP`.

## Step 5: Merchant admin: UPI ID and WhatsApp

Open `https://pay-admin.gaadiglow.in` and paste the admin token.

1. **Receiving account**: the client's business UPI ID and the name the bank shows.
2. **WhatsApp**: link the spare WhatsApp number (scan the QR from that phone's WhatsApp → Linked devices, or use the pairing code).

## Step 6: Observers (how payments get confirmed)

Follow the gateway's own guides in `~/youpi-pg/docs/`:

- `ANDROID_MOBILE_APP.md` and `OBSERVERS_SETUP.md` → **Android observer**: install the observer app on the phone with the bank SIM and pair it in merchant admin. Turn off battery optimisation for it and keep the phone on charge and on Wi-Fi.
- `OBSERVERS_SETUP.md` → **Gmail observer**, and `google_cloud_console_setup_guide.md` for the Google sign-in keys (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` in `.env`; redirect address `https://pay-gmail.gaadiglow.in/oauth/callback`). Switch on email alerts for credits in the bank's net banking.

When both are connected the checkout shows the green **Server Is Working** badge.

## Step 7: Connect it to GaadiGlow

The webhook address is `https://asia-south1-YOUR-PROJECT-ID.cloudfunctions.net/youpiWebhook` (Firebase also prints it when you deploy in Step 8; it works before the deploy is done, the gateway just retries).

On the gateway server:

```bash
cd ~/payment-gateway
ADMIN_API_TOKEN=$(grep ^ADMIN_API_TOKEN= ~/youpi-pg/.env | cut -d= -f2) \
YOUPI_API_URL=http://127.0.0.1:6100 \
UPI_ID=gaadiglow@okhdfcbank PAYEE_NAME="GaadiGlow" \
WEBHOOK_URL=https://asia-south1-YOUR-PROJECT-ID.cloudfunctions.net/youpiWebhook \
SITE_URL=https://gaadiglow.in SUPPORT_MOBILE=98XXXXXXXX SUPPORT_EMAIL=support@gaadiglow.in \
node configure-gateway.mjs
```

It saves the business details, the GaadiGlow branding (name, colour, plain wording instead of the template's marketing banners) and the webhook, then prints `YOUPI_MERCHANT_ID` and `YOUPI_MERCHANT_KEY`. The key signs webhooks and authorises new payments, so treat it like a password.

## Step 8: Firebase side

In the GaadiGlow folder on your laptop:

1. Create `functions/.env`:
   ```
   YOUPI_API_URL=https://pay-api.gaadiglow.in
   YOUPI_MERCHANT_ID=paste-the-merchant-id
   ```
2. Store the key as a secret and deploy the two functions:
   ```bash
   cd functions && npm install && cd ..
   firebase functions:secrets:set YOUPI_MERCHANT_KEY
   firebase deploy --only functions:createYoupiPayment,functions:youpiWebhook,firestore
   ```
3. In `public/firebase-config.js`:
   ```js
   window.GG_YOUPI = { portalUrl: 'https://pay.gaadiglow.in' };
   ```
   then `firebase deploy --only hosting`.

The app now offers **Pay now by UPI** in the booking wizard and a **Pay ₹… by UPI** button on the tracking page (for prepaid bookings, and for any booking once the wash has started).

Webhook deliveries are recorded in the Firestore collection `paymentEvents` (one document per delivery). Phones can't read it (no rule allows it); look at it in the Firebase console if a payment ever needs checking.

## Step 9: Test with real money (small)

1. In the owner console, temporarily set one package price to ₹10 → **Save**.
2. Book it on your phone with **Pay now by UPI** → the checkout sheet opens → WhatsApp code → pay ₹10 with any UPI app.
3. Within about half a minute: the sheet shows **Payment Successful**, the tracking page shows **Paid ₹10 online · UPI ref …**, and the owner console's booking drawer shows the same UPI ref.
4. Put the price back.

If step 3 does not happen, see below.

## When something goes wrong

| What you see | Usual cause | Fix |
|---|---|---|
| "UPI payments are not set up yet" toast | `functions/.env` or the secret missing | Step 8, then redeploy functions |
| "The UPI payment server is not reachable right now…" | Gateway or tunnel down | `sudo systemctl status youpi-pg`, check the tunnel in Cloudflare |
| Checkout sheet stays white | App address missing in `CHECKOUT_FRAME_ANCESTORS` | Add it to `.env`, restart the gateway |
| Red "Server Facing Issues" in the checkout | Neither observer is connected | Check the Android phone (on, online, app running) and Gmail |
| Customer paid but app stays on "Confirming…" | Credit alert not seen, or webhook failing | Merchant admin → payments: is it VERIFIED? If yes, check the webhook URL and the Cloud Function logs (`firebase functions:log --only youpiWebhook`). The gateway retries webhooks 5 times |
| Function log says `amount-mismatch` | Booking price changed after the checkout was created | Mark it paid by hand after checking the bank statement |
| Checkout says the session was created on another device | The customer started paying on one phone and tapped Pay on another within 5 minutes | Finish on the first phone, or wait 5 minutes and tap Pay again. (Tapping Pay again on the **same** phone, even after closing the app, simply reopens the same checkout) |
| "Order … already exists with a different amount" | The owner changed this booking's price after the customer started paying | Collect by cash/UPI to the washer, or cancel and rebook |

## Updating

```bash
cd ~/youpi-pg && git fetch && git checkout <new version> && npm install
node ~/payment-gateway/apply-gaadiglow-theme.mjs ~/youpi-pg
sudo systemctl restart youpi-pg
```

Test one ₹10 payment after every update. Back up `~/youpi-pg/data/` and `~/youpi-pg/.env` regularly; the database holds every payment record.

## Trying it on your own computer first (no real money)

Put these in `.env` (they must never be on the real server):

```
YOUPI_MODE=localhost
YOUPI_ALLOW_LOCALHOST_MODE=true
YOUPI_ALLOW_PRIVATE_WEBHOOKS=true
YOUPI_EXPOSE_DEV_OTP=true
CHECKOUT_FRAME_ANCESTORS=http://localhost:5000
BASE_CHECKOUT_URL=http://localhost:7000
BASE_PAYMENT_API_URL=http://localhost:6100
```

With these, the WhatsApp code is returned to the browser instead of sent, and merchant admin can simulate a bank SMS for an open checkout (`POST /api/v1/checkout/<id>/simulate-observation`). GaadiGlow was tested this way: app → Cloud Function logic → gateway checkout inside the app → simulated "Rs 549.00 credited … UPI Ref …" SMS → signed webhook → booking marked paid with that UPI ref. A repeated UPI ref is rejected by the gateway.
