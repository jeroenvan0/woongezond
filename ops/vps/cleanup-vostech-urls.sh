#!/usr/bin/env bash
# Retire the three legacy vostech.group URLs. Keeps the directories on disk; only
# woongezond.com/admin (and dev.woongezond.com/admin once set up) remain.
#   woongezond.vostech.group        -> old Python Dash app,  systemd woongezond,     port 8050
#   dev.woongezond.vostech.group    -> old Python Dash app,  systemd woongezond-dev, port 8051
#   woongezond-react.vostech.group  -> duplicate of woongezond.com/admin (same port 3001)
set -euo pipefail
echo "== stop + disable old Dash apps"
systemctl disable --now woongezond.service woongezond-dev.service || true
echo "== remove nginx sites"
rm -fv /etc/nginx/sites-enabled/woongezond /etc/nginx/sites-enabled/woongezond-dev /etc/nginx/sites-enabled/woongezond-react
nginx -t && systemctl reload nginx
echo "== kill stray next-server processes started by hand from an SSH session (e.g. the one on :3999)"
# Only processes in a systemd *session* scope (interactive shells) whose cwd is a woongezond checkout.
# Never touch systemd services or Docker containers (offertefeest and Supabase Studio are Next.js too).
for pid in $(pgrep -f 'next-server' || true); do
  unit=$(sed 's#.*/##' /proc/$pid/cgroup 2>/dev/null || true)
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
  case "$unit" in
    session-*.scope) case "$cwd" in /var/www/woongezond*) echo "killing $pid ($unit, $cwd)"; kill "$pid" || true ;; esac ;;
  esac
done
echo "== drop the three certificates (certbot stops renewing them)"
for c in woongezond.vostech.group dev.woongezond.vostech.group woongezond-react.vostech.group; do
  certbot delete --cert-name "$c" --non-interactive || true
done
echo "== check"
ss -tlnp | grep -E ':(8050|8051|3999) ' && echo "WARNING: something still listens" || echo "ports 8050/8051/3999 closed"
for u in https://woongezond.vostech.group/ https://dev.woongezond.vostech.group/ https://woongezond-react.vostech.group/ https://woongezond.com/admin; do
  printf "%-45s " "$u"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 "$u" || true
done
