#!/usr/bin/env python3
"""
Supabase Cloud → VPS nightly backup sync
=========================================
Fetches new/updated rows from the cloud instance and upserts them into the
local VPS Supabase (running in Docker). Safe to re-run; uses watermarks so
it only syncs what changed since the last run.

Every run is logged to public.sync_runs on the local Supabase (viewable in
Studio). On success, a healthchecks.io URL is pinged so you get an e-mail
alert if the job stops running.

Config: /opt/supabase-sync/.env
Logs:   /var/log/supabase-sync/sync.log
State:  /opt/supabase-sync/last_sync.json
"""

import json
import logging
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

CLOUD_URL  = "https://vciwibiiisobhotzxcyn.supabase.co"
ENV_FILE   = Path("/opt/supabase-sync/.env")
STATE_FILE = Path("/opt/supabase-sync/last_sync.json")
LOG_FILE   = Path("/var/log/supabase-sync/sync.log")
PAGE_SIZE  = 1000

LOCAL_PSQL = [
    "docker", "exec", "-i", "supabase-db",
    "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1",
]

# ── Table definitions ─────────────────────────────────────────────────────────
TABLES = [
    # (naam,                      watermerk,     upsert)
    # VOLGORDE IS FUNCTIONEEL: ouders vóór kinderen. air_quality stond hiervoor bovenaan,
    # dus de metingen van een nieuwe sensor kwamen aan vóór de sensor zelf → foreign key
    # violation → de hele tabel faalde. Sinds 7 sep 2026 legde dat de backup stil.
    ("organizations",            "created_at",  "nothing"),
    ("profiles",                 "updated_at",  "update"),
    ("org_members",              "created_at",  "nothing"),
    ("org_invites",              "created_at",  "nothing"),
    ("cities",                   "created_at",  "nothing"),
    ("devices",                  "updated_at",  "update"),
    ("device_claim_codes",       "created_at",  "nothing"),
    ("device_contacts",          "updated_at",  "update"),
    ("device_photos",            "created_at",  "nothing"),
    ("air_quality",              "created_at",  "nothing"),
    ("city_weather",             "created_at",  "nothing"),
    ("thresholds",               "created_at",  "nothing"),
    ("notifications",            "created_at",  "nothing"),
    ("events",                   "created_at",  "nothing"),
    ("chat_sessions",            "updated_at",  "update"),
    ("chat_messages",            "created_at",  "nothing"),
    ("feedback",                 "created_at",  "nothing"),
    ("household_consents",       "granted_at",  "nothing"),
    ("interventions",            "created_at",  "nothing"),
    ("ml_models",                "trained_at",  "update"),
    ("ml_feedback",              "created_at",  "nothing"),
    ("report_sends",             "sent_at",     "nothing"),
    ("support_messages",         "created_at",  "nothing"),
    ("scenario_snapshots",       "created_at",  "nothing"),
    ("scenario_recommendations", "created_at",  "nothing"),
    ("scenario_feedback",        "created_at",  "nothing"),
]

# Tabellen zonder id-kolom: waarop botst de upsert?
CONFLICT_KEY = {"device_contacts": "device_id", "ml_models": "user_id"}


UPDATABLE_COLS = {
    "profiles":      ["first_name", "last_name", "email", "role", "updated_at"],
    "devices":       ["name", "location", "type", "active", "lat", "lon", "city", "updated_at"],
    "chat_sessions": ["title", "message_count", "updated_at"],
}

# ── Logging ───────────────────────────────────────────────────────────────────

LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("supabase-sync")


# ── Load .env ─────────────────────────────────────────────────────────────────

def load_env():
    if not ENV_FILE.exists():
        log.error("Missing config: %s", ENV_FILE)
        sys.exit(1)
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))

load_env()

SERVICE_ROLE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
HEALTHCHECKS_URL  = os.getenv("HEALTHCHECKS_URL", "").strip()

if not SERVICE_ROLE_KEY or SERVICE_ROLE_KEY.startswith("PASTE_"):
    log.error("SUPABASE_SERVICE_ROLE_KEY is not set in %s", ENV_FILE)
    log.error("Get it: Supabase dashboard → Settings → API → service_role")
    sys.exit(1)


# ── State (watermarks) ────────────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    default = "2026-05-24T00:00:00+00:00"
    return {name: default for name, _, _ in TABLES}

def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ── REST API helpers ──────────────────────────────────────────────────────────

def api_get(path: str, params: dict = None) -> list:
    qs = ("?" + "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())) if params else ""
    url = f"{CLOUD_URL}/rest/v1/{path}{qs}"
    req = urllib.request.Request(url, headers={
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Accept":        "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        log.error("API %s → HTTP %s: %s", url, e.code, e.read().decode()[:200])
        raise

def api_post(path: str, payload: dict) -> bool:
    """Eén rij naar de cloud schrijven met de service-role. Best effort."""
    url = f"{CLOUD_URL}/rest/v1/{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "apikey":        SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception as e:
        log.warning("  cloud-logregel mislukt: %s", e)
        return False


def fetch_new_rows(table: str, wm_col: str, since: str) -> list:
    all_rows: list = []
    offset = 0
    while True:
        rows = api_get(table, {
            "select":   "*",
            wm_col:     f"gt.{since}",
            "order":    f"{wm_col}.asc",
            "limit":    PAGE_SIZE,
            "offset":   offset,
        })
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += len(rows)
    return all_rows

def fetch_new_auth_users(since: str) -> list:
    url = f"{CLOUD_URL}/auth/v1/admin/users?per_page=1000"
    req = urllib.request.Request(url, headers={
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        users = data.get("users", [])
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        return [u for u in users if datetime.fromisoformat(
            u["created_at"].replace("Z", "+00:00")) > since_dt]
    except Exception as e:
        log.warning("Auth users sync skipped: %s", e)
        return []


# ── SQL helpers ───────────────────────────────────────────────────────────────

def q(v) -> str:
    if v is None:                   return "NULL"
    if isinstance(v, bool):         return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'"
    return "'" + str(v).replace("'", "''") + "'"

_local_cols: dict = {}

def local_columns(table: str) -> set:
    """Welke kolommen heeft de lokale tabel? Gecachet per run.

    De cloud krijgt regelmatig kolommen erbij (city_id, house_profile, ingest_token...).
    Het script haalde `select=*` op en propte alles in de lokale tabel, dus elke migratie
    in de cloud brak hier stilletjes de backup. Nu syncen we de doorsnede en loggen we wat
    er is overgeslagen: je ziet dat het schema uit de pas loopt zonder dat data wegvalt.
    """
    if table in _local_cols:
        return _local_cols[table]
    sql = ("select column_name from information_schema.columns "
           f"where table_schema='public' and table_name='{table}';")
    r = subprocess.run(LOCAL_PSQL + ["-t", "-A"], input=sql.encode(), capture_output=True)
    cols = {l.strip() for l in r.stdout.decode().splitlines() if l.strip()}
    _local_cols[table] = cols
    return cols


def build_upsert_sql(table: str, rows: list, upsert_action: str) -> str:
    if not rows:
        return ""
    known = local_columns(table)
    cols = [c for c in rows[0].keys() if not known or c in known]
    skipped = [c for c in rows[0].keys() if known and c not in known]
    if skipped:
        log.warning("  %-30s kolommen niet in de backup: %s", table, ", ".join(skipped))
    if not cols:
        return ""
    key = CONFLICT_KEY.get(table, "id")
    col_list = ", ".join(cols)
    value_rows = ["  (" + ", ".join(q(row.get(c)) for c in cols) + ")" for row in rows]
    if upsert_action == "nothing":
        conflict = "ON CONFLICT DO NOTHING"
    else:
        upd = UPDATABLE_COLS.get(table, [c for c in cols if c != key])
        conflict = f"ON CONFLICT ({key}) DO UPDATE SET " + ", ".join(
            f"{c} = EXCLUDED.{c}" for c in upd if c in cols and c != key)
    return f"INSERT INTO public.{table} ({col_list})\nVALUES\n" + ",\n".join(value_rows) + f"\n{conflict};"

def run_sql(sql: str) -> int:
    r = subprocess.run(LOCAL_PSQL, input=sql.encode(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:500])
    for line in r.stdout.decode().splitlines():
        if line.startswith("INSERT"):
            parts = line.split()
            if len(parts) >= 3:
                return int(parts[2])
    return 0

def upsert_auth_users(users: list) -> int:
    if not users:
        return 0
    rows = []
    for u in users:
        rows.append("(" + ", ".join([
            q(u.get("id")), q(u.get("email")), q(u.get("encrypted_password")),
            q(u.get("email_confirmed_at")), q(u.get("created_at")), q(u.get("updated_at")),
            q(json.dumps(u.get("raw_user_meta_data") or {})) + "::jsonb",
            q(json.dumps(u.get("raw_app_meta_data") or {})) + "::jsonb",
            q(u.get("role", "authenticated")), q(u.get("aud", "authenticated")),
            q(u.get("confirmation_token", "")), q(u.get("recovery_token", "")),
        ]) + ")")
    sql = (
        "INSERT INTO auth.users "
        "(id,email,encrypted_password,email_confirmed_at,created_at,updated_at,"
        "raw_user_meta_data,raw_app_meta_data,role,aud,confirmation_token,recovery_token)\n"
        "VALUES\n" + ",\n".join(rows) + "\n"
        "ON CONFLICT (id) DO UPDATE SET "
        "email=EXCLUDED.email, updated_at=EXCLUDED.updated_at, "
        "raw_user_meta_data=EXCLUDED.raw_user_meta_data, "
        "raw_app_meta_data=EXCLUDED.raw_app_meta_data;"
    )
    return run_sql(sql)


# ── sync_runs tabel logging ───────────────────────────────────────────────────

def log_run_start(started_at: datetime) -> int:
    """Insert een 'running' rij en geef het ID terug."""
    sql = (
        "INSERT INTO public.sync_runs (started_at, status) "
        f"VALUES ({q(started_at.isoformat())}, 'running') RETURNING id;"
    )
    r = subprocess.run(LOCAL_PSQL + ["-t"], input=sql.encode(), capture_output=True)
    try:
        # psql -t output: "  2\n\nINSERT 0 1\n" — pak de eerste regel met een getal
        lines = [l.strip() for l in r.stdout.decode().splitlines() if l.strip().lstrip("-").isdigit()]
        return int(lines[0]) if lines else -1
    except Exception:
        return -1

def log_run_finish(run_id: int, status: str, rows_synced: int,
                   tables_ok: list, tables_failed: list,
                   duration_s: float, error_detail: str = None):
    if run_id < 0:
        return
    ok_arr   = "ARRAY[" + ",".join(q(t) for t in tables_ok)   + "]" if tables_ok   else "ARRAY[]::text[]"
    fail_arr = "ARRAY[" + ",".join(q(t) for t in tables_failed) + "]" if tables_failed else "ARRAY[]::text[]"
    err      = q(error_detail) if error_detail else "NULL"
    sql = (
        f"UPDATE public.sync_runs SET "
        f"  finished_at = NOW(), "
        f"  status = {q(status)}, "
        f"  rows_synced = {rows_synced}, "
        f"  tables_ok = {ok_arr}, "
        f"  tables_failed = {fail_arr}, "
        f"  duration_s = {round(duration_s, 2)}, "
        f"  error_detail = {err} "
        f"WHERE id = {run_id};"
    )
    subprocess.run(LOCAL_PSQL, input=sql.encode(), capture_output=True)


# ── Healthchecks.io ping ──────────────────────────────────────────────────────

def ping_healthchecks(success: bool):
    if not HEALTHCHECKS_URL:
        return
    url = HEALTHCHECKS_URL if success else HEALTHCHECKS_URL.rstrip("/") + "/fail"
    try:
        urllib.request.urlopen(url, timeout=10)
        log.info("  healthchecks.io ping ✓ (%s)", "success" if success else "FAIL")
    except Exception as e:
        log.warning("  healthchecks.io ping mislukt: %s", e)


# ── Main sync loop ────────────────────────────────────────────────────────────

def sync():
    start  = datetime.now(timezone.utc)
    run_id = log_run_start(start)

    log.info("=" * 60)
    log.info("Supabase sync gestart  %s  (run #%s)", start.strftime("%Y-%m-%d %H:%M UTC"), run_id)
    log.info("=" * 60)

    state      = load_state()
    new_state  = dict(state)
    total_rows = 0
    tables_ok: list[str]     = []
    tables_failed: list[str] = []

    # ── Auth users ────────────────────────────────────────────────────────────
    auth_since = state.get("_auth_users", "2026-05-24T00:00:00+00:00")
    try:
        new_users = fetch_new_auth_users(auth_since)
        if new_users:
            upsert_auth_users(new_users)
            log.info("  auth.users            → %d nieuw/gewijzigd", len(new_users))
            total_rows += len(new_users)
        else:
            log.info("  auth.users            → 0 nieuw")
        tables_ok.append("auth.users")
        new_state["_auth_users"] = start.isoformat()
    except Exception as e:
        log.error("  auth.users            ✗  %s", e)
        tables_failed.append("auth.users")

    # ── Public tables ─────────────────────────────────────────────────────────
    for table, wm_col, upsert_action in TABLES:
        since = state.get(table, "2026-05-24T00:00:00+00:00")
        try:
            rows = fetch_new_rows(table, wm_col, since)
            if rows:
                inserted = 0
                for i in range(0, len(rows), 500):
                    chunk = rows[i:i + 500]
                    sql   = build_upsert_sql(table, chunk, upsert_action)
                    inserted += run_sql(sql)
                log.info("  %-30s → %4d rijen  (opgehaald: %d)", table, inserted, len(rows))
                total_rows        += len(rows)
                new_state[table]   = rows[-1][wm_col]
            else:
                log.info("  %-30s → 0 nieuw", table)
                new_state[table] = start.isoformat()
            tables_ok.append(table)
        except Exception as e:
            log.error("  %-30s ✗  %s", table, e)
            tables_failed.append(table)

    # ── Sla watermarks op ─────────────────────────────────────────────────────
    if not tables_failed:
        save_state(new_state)
    else:
        # Sla alleen de watermarks op van tabellen die WEL geslaagd zijn
        for t in tables_ok:
            state[t] = new_state.get(t, state.get(t))
        save_state(state)

    # ── Afronden ─────────────────────────────────────────────────────────────
    elapsed = (datetime.now(timezone.utc) - start).total_seconds()
    success = len(tables_failed) == 0
    status  = "success" if success else "error"
    error_detail = f"Mislukt: {', '.join(tables_failed)}" if tables_failed else None

    log_run_finish(run_id, status, total_rows, tables_ok, tables_failed, elapsed, error_detail)

    # Dezelfde regel naar de cloud (tabel public.sync_runs, migratie 20260908150000).
    # De lokale sync_runs staat op deze VPS en is onzichtbaar voor de app; daardoor kon de
    # backup drie nachten falen zonder dat iemand het merkte. /beheer leest deze kopie.
    api_post("sync_runs", {
        "started_at":    start.isoformat(),
        "finished_at":   datetime.now(timezone.utc).isoformat(),
        "status":        status,
        "rows_synced":   total_rows,
        "tables_ok":     tables_ok,
        "tables_failed": tables_failed,
        "duration_s":    round(elapsed, 2),
        "error_detail":  error_detail,
        "source":        "vps-backup",
    })

    ping_healthchecks(success)

    verdict = "✓ KLAAR" if success else f"⚠ KLAAR MET FOUTEN ({', '.join(tables_failed)})"
    log.info("%s — %d rijen gesynchroniseerd in %.1fs", verdict, total_rows, elapsed)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(sync())
