// GaadiGlow settings for the hosted app. README.md explains each step.

// 1) Firebase keys. While this is null the app runs as a demo that saves data
//    only in the browser it is opened in. Paste your firebaseConfig object here
//    (Firebase console → Project settings → Your apps → Web app).
window.GG_FIREBASE_CONFIG = null;

// 2) Login methods (Firebase Authentication).
//    phone:  mobile number + 6-digit OTP by SMS (the main login). Needs the Blaze plan;
//            SMS to India is billed per message after a small free allowance.
//    google: optional extra button "Continue with Google" (free). Off by default.
window.GG_AUTH = { phone: true, google: false };

// 3) Online payment through Razorpay. Turn on only after the Cloud Functions in
//    /functions are deployed with your Razorpay keys (needs the Blaze plan).
window.GG_RAZORPAY = false;

// 4) UPI payments through your own self-hosted YouPI-PG gateway (payment-gateway/README.md).
//    Set the address of the gateway's checkout portal to switch it on; it then replaces
//    Razorpay as the "Pay now" option. Keep null to use Razorpay (if switched on above)
//    or no online payment at all; cash and UPI-to-the-washer always stay available.
//    window.GG_YOUPI = { portalUrl: 'https://pay.gaadiglow.in' };
window.GG_YOUPI = null;

/* What a filled-in config looks like (placeholder values):
window.GG_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "gaadiglow-blr.firebaseapp.com",
  projectId: "gaadiglow-blr",
  storageBucket: "gaadiglow-blr.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
*/
