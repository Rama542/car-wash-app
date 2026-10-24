#!/usr/bin/env bash
# Installs the YouPI-PG gateway for GaadiGlow on a Linux server (for example Ubuntu 22.04 or 24.04).
#   bash setup.sh            -> installs into ~/youpi-pg
#   bash setup.sh /srv/pay   -> installs into /srv/pay
# What it does: downloads YouPI-PG from GitHub at a tested version, installs it, writes .env
# with fresh secrets, creates the database and applies the GaadiGlow look.
# It never deletes anything; run it again safely (it skips steps already done).
set -euo pipefail

REPO="${YOUPI_REPO:-https://github.com/youpi-pg/YouPI-PG.git}"
TESTED_COMMIT="d7b07414d803094525ceedd5cf81e8a38157263e"   # version GaadiGlow was tested with
DIR="${1:-$HOME/youpi-pg}"
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mStopped:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git  >/dev/null || die "git is not installed. Run: sudo apt-get install -y git"
command -v node >/dev/null || die "Node.js is not installed. Install Node.js 24 (https://nodejs.org) and run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  die "Node.js $(node -v) is too old. The gateway needs Node.js 24 (22.13 or newer at the very least)."
fi
[ "$NODE_MAJOR" -lt 24 ] && echo "Note: the gateway asks for Node.js 24; $(node -v) may work but 24 is recommended."

say "1/5  Downloading YouPI-PG into $DIR"
if [ -d "$DIR/.git" ]; then
  echo "Already downloaded, keeping it."
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR"
if [ "${YOUPI_LATEST:-0}" = "1" ]; then
  echo "YOUPI_LATEST=1: staying on the newest version (not the one GaadiGlow was tested with)."
else
  git -c advice.detachedHead=false checkout -q "$TESTED_COMMIT" || die "Could not switch to the tested version $TESTED_COMMIT."
  echo "Using tested version ${TESTED_COMMIT:0:7}."
fi

say "2/5  Installing packages (a few minutes)"
npm install --no-audit --no-fund

say "3/5  Writing .env"
if [ -f .env ]; then
  echo ".env already exists, leaving it alone."
else
  cp "$KIT/gateway.env.example" .env
  chmod 600 .env
  while grep -q '__GENERATE__' .env; do
    secret="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
    # replace the first remaining placeholder with its own random value
    node -e '
      const fs = require("fs"); const f = ".env";
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("__GENERATE__", process.argv[1]));
    ' "$secret"
  done
  echo "Created .env with new secrets. Open it and fix the lines marked EDIT before starting."
fi

say "4/5  Creating the database"
if [ -f data/youpi_pg.sqlite ]; then
  echo "Database already exists, leaving it alone."
else
  npm run db:setup
fi

say "5/5  Applying the GaadiGlow look"
node "$KIT/apply-gaadiglow-theme.mjs" "$DIR"

cat <<EOF

Done. Next:
  1. nano $DIR/.env          (fix every line marked EDIT)
  2. cd $DIR && npm start    (or set it up as a service, see README step 4)
  3. Follow README.md from step 4: UPI ID, WhatsApp, observer phone, then configure-gateway.mjs.

Your merchant admin password (ADMIN_API_TOKEN) is in $DIR/.env
EOF
