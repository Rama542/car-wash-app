#!/usr/bin/env node
// Applies the GaadiGlow look to a YouPI-PG checkout portal.
// Usage: node apply-gaadiglow-theme.mjs /path/to/YouPI-PG
// Safe to run again: it copies one CSS file, adds one <link> tag and swaps a few
// fixed product-name texts that CSS cannot reach.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || '.');
const cssDir = path.join(root, 'apps/checkout-portal/public/css');
const view = path.join(root, 'apps/checkout-portal/src/views/checkout.html');
if (!fs.existsSync(cssDir) || !fs.existsSync(view)) {
  console.error(`Not a YouPI-PG folder: ${root}\n(expected apps/checkout-portal inside it)`);
  process.exit(1);
}

// 1) the stylesheet
fs.copyFileSync(path.join(here, 'gaadiglow-theme.css'), path.join(cssDir, 'gaadiglow-theme.css'));
const link = '<link rel="stylesheet" href="/css/gaadiglow-theme.css">';
let html = fs.readFileSync(view, 'utf8');
if (!html.includes(link)) {
  const anchor = '<link rel="stylesheet" href="/css/checkout.css">';
  if (!html.includes(anchor)) { console.error('Could not find the checkout.css link in checkout.html; add this line after it by hand:\n' + link); process.exit(1); }
  html = html.replace(anchor, anchor + '\n  ' + link);
  fs.writeFileSync(view, html);
}

// 2) texts with the gateway's own name in them
const SUCCESS = 'Your UPI payment was received and checked with the bank.';
const swaps = [
  ['apps/checkout-portal/src/views/partials/auth.html', [[/New to YOUPI PG\?/g, 'New here?']]],
  ['apps/checkout-portal/src/views/checkout.html', [
    [/Your payment was automatically verified by YouPI PG banking observers\./g, SUCCESS],
    [/Your payment was automatically verified by banking observers\./g, SUCCESS]
  ]],
  ['apps/checkout-portal/src/views/partials/payment-methods.html', [
    [/Your payment was automatically verified by YouPI PG banking observers\./g, SUCCESS]
  ]]
];
let changed = 0;
for (const [rel, list] of swaps) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [re, to] of list) after = after.replace(re, to);
  if (after !== before) { fs.writeFileSync(file, after); changed++; }
}
console.log('GaadiGlow theme applied to', path.relative(process.cwd(), view) || view, changed ? `(${changed} text file(s) updated)` : '');
