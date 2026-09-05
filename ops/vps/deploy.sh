#!/usr/bin/env bash
# Deploy prod (main) or dev (dev) on the VPS.
#   ops/vps/deploy.sh prod    # /var/www/woongezond-dev-react  -> main -> woongezond.com/admin     (port 3001)
#   ops/vps/deploy.sh dev     # /var/www/woongezond-react-dev  -> dev  -> dev.woongezond.com/admin (port 3002)
set -euo pipefail
case "${1:-}" in
  prod) DIR=/var/www/woongezond-dev-react; BRANCH=main; UNIT=woongezond-react;     URL=https://woongezond.com/admin ;;
  dev)  DIR=/var/www/woongezond-react-dev; BRANCH=dev;  UNIT=woongezond-react-dev; URL=https://dev.woongezond.com/admin ;;
  *) echo "usage: $0 prod|dev"; exit 1 ;;
esac
cd "$DIR"
echo "== $UNIT: $(git rev-parse --short HEAD) -> origin/$BRANCH"
git fetch -q origin
git checkout -q "$BRANCH"
git pull -q --ff-only origin "$BRANCH"
echo "== now at $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
npm ci --no-audit --no-fund
npm run build
systemctl restart "$UNIT"
sleep 3
systemctl is-active "$UNIT"
printf "%s -> " "$URL"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 "$URL"
