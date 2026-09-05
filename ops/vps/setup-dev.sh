#!/usr/bin/env bash
# One-time setup of dev.woongezond.com/admin: a second checkout on the `dev` branch,
# its own systemd unit on port 3002 and an nginx site with a Let's Encrypt cert.
# Prerequisite: an A record dev.woongezond.com -> this VPS (153.92.223.130) at Strato.
set -euo pipefail
PROD=/var/www/woongezond-dev-react
DIR=/var/www/woongezond-react-dev
HOST=dev.woongezond.com
HERE=$(cd "$(dirname "$0")" && pwd)

if [ ! -d "$DIR/.git" ]; then
  echo "== clone dev branch"
  git clone -q --branch dev git@github.com:jeroenvan0/woongezond.git "$DIR"
fi
if [ ! -f "$DIR/.env.local" ]; then
  echo "== env: copy of prod with PORT=3002 (same Supabase project, same basePath /admin)"
  sed -E 's/^PORT=.*/PORT=3002/' "$PROD/.env.local" > "$DIR/.env.local"
  grep -q '^PORT=' "$DIR/.env.local" || echo "PORT=3002" >> "$DIR/.env.local"
  chmod 600 "$DIR/.env.local"
fi

echo "== systemd unit"
cp "$HERE/woongezond-react-dev.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable woongezond-react-dev.service

echo "== nginx site (http first; certbot adds https)"
cp "$HERE/nginx-dev.woongezond.com" /etc/nginx/sites-available/dev.woongezond.com
ln -sf /etc/nginx/sites-available/dev.woongezond.com /etc/nginx/sites-enabled/dev.woongezond.com
nginx -t && systemctl reload nginx

echo "== first build + start"
"$HERE/deploy.sh" dev || true

if [ "$(dig +short "$HOST" A | tail -1)" = "$(curl -s --max-time 5 https://api.ipify.org)" ]; then
  echo "== DNS ok, requesting certificate"
  certbot --nginx -d "$HOST" --non-interactive --agree-tos --redirect --keep-until-expiring \
    --email "$(grep -m1 -oE '[^ ]+@[^ ]+' /etc/letsencrypt/renewal/woongezond.com.conf 2>/dev/null || echo woongezond@vostech.group)"
  printf "https://%s/admin -> " "$HOST"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 "https://$HOST/admin"
else
  echo "!! DNS for $HOST does not point here yet. Add the A record, then run:"
  echo "   certbot --nginx -d $HOST --redirect"
fi
