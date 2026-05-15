import os
import signal
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from scipy.optimize import curve_fit
from scipy.signal import find_peaks
from scipy import stats
import zoneinfo

import dash
from dash import dcc, html, Input, Output, callback
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from supabase import create_client
from supabase._sync.client import SupabaseException

# ── Config ────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent


def _safe_load_dotenv(env_path: Path):
    """Load .env defensively without relying on python-dotenv parsing."""
    previous_handler = None

    def _handle_alarm(_signum, _frame):
        raise TimeoutError("Timed out while reading .env")

    try:
        if hasattr(signal, "SIGALRM"):
            previous_handler = signal.getsignal(signal.SIGALRM)
            signal.signal(signal.SIGALRM, _handle_alarm)
            signal.alarm(2)
        if not env_path.exists():
            return None

        for raw_line in env_path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)

        return None
    except (OSError, TimeoutError) as exc:
        return str(exc)
    finally:
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)
            if previous_handler is not None:
                signal.signal(signal.SIGALRM, previous_handler)


DOTENV_LOAD_ERROR = None
DOTENV_LOAD_ERROR = _safe_load_dotenv(BASE_DIR / ".env")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

TIMEZONE_NAME = os.getenv("APP_TIMEZONE", "Europe/Amsterdam")
try:
    TZ = zoneinfo.ZoneInfo(TIMEZONE_NAME)
except zoneinfo.ZoneInfoNotFoundError:
    TZ = zoneinfo.ZoneInfo("UTC")

APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = _env_int("APP_PORT", _env_int("PORT", 8050))
APP_DEBUG = _env_bool("DASH_DEBUG", False)
MAX_POINTS = _env_int("MAX_POINTS", 50000)
MAX_FETCH_ROWS = _env_int("MAX_FETCH_ROWS", 600000)
SUPABASE_PAGE_SIZE = _env_int("SUPABASE_PAGE_SIZE", 1000)

SUPABASE_INIT_ERROR = None
if not SUPABASE_URL or not SUPABASE_KEY:
    supabase = None
    SUPABASE_INIT_ERROR = "Missing SUPABASE_URL or SUPABASE_KEY."
    if DOTENV_LOAD_ERROR:
        SUPABASE_INIT_ERROR += f" .env load error: {DOTENV_LOAD_ERROR}"
else:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except (SupabaseException, Exception) as exc:
        supabase = None
        SUPABASE_INIT_ERROR = str(exc)

# ── Kleuren ───────────────────────────────────────────
C_CO2   = "#0B5FA5"
C_TEMP  = "#B4532E"
C_RH    = "#13795B"
C_MOULD = "#D14A45"
C_VOC   = "#2D6D8A"
BG      = "#F8F6F0"
SURFACE = "#FFFFFF"
BORDER  = "rgba(42, 58, 76, 0.14)"
TEXT    = "#182431"
MUTED   = "#5F6C79"
RED     = "#D14A45"
AMBER   = "#AD7A1E"
GREEN   = "#2A7A41"

PERIOD_OPTIONS = [
    {"label": "Laatste 30 min",  "value": 30},
    {"label": "Laatste uur",     "value": 60},
    {"label": "Laatste 6 uur",   "value": 360},
    {"label": "Laatste 24 uur",  "value": 1440},
    {"label": "Laatste 7 dagen", "value": 10080},
    {"label": "Laatste 30 dagen","value": 43200},
    {"label": "Laatste jaar",    "value": 525600},
]

TAB_STYLE = {
    "padding": "9px 15px",
    "fontSize": "12px",
    "letterSpacing": "0.02em",
    "textTransform": "uppercase",
    "fontWeight": "700",
    "color": MUTED,
    "border": f"1px solid {BORDER}",
    "background": "rgba(255,255,255,0.75)",
    "borderRadius": "999px",
    "marginRight": "6px",
}
TAB_SELECTED = {
    **TAB_STYLE,
    "color": "#FFFFFF",
    "background": C_CO2,
    "border": f"1px solid {C_CO2}",
}


# ══════════════════════════════════════════════════════
# DATA OPHALEN
# ══════════════════════════════════════════════════════

def kies_bucket_minutes(minutes: int) -> int:
    if minutes <= 2 * 1440:
        return 1
    if minutes <= 7 * 1440:
        return 5
    if minutes <= 30 * 1440:
        return 15
    if minutes <= 90 * 1440:
        return 60
    if minutes <= 365 * 1440:
        return 360
    return 720


def aggregateer_rows(rows, bucket_minutes: int):
    if bucket_minutes <= 1 or not rows:
        return rows

    bucket_seconds = bucket_minutes * 60
    buckets = {}

    for r in rows:
        ts_utc = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
        key = int(ts_utc.timestamp()) // bucket_seconds
        b = buckets.setdefault(
            key,
            {
                "created_at": ts_utc,
                "co2": [],
                "temperature": [],
                "humidity": [],
            },
        )

        if ts_utc > b["created_at"]:
            b["created_at"] = ts_utc

        if r.get("co2") is not None:
            b["co2"].append(float(r["co2"]))
        if r.get("temperature") is not None:
            b["temperature"].append(float(r["temperature"]))
        if r.get("humidity") is not None:
            b["humidity"].append(float(r["humidity"]))

    result = []
    for key in sorted(buckets.keys()):
        b = buckets[key]
        result.append(
            {
                "created_at": b["created_at"].isoformat().replace("+00:00", "Z"),
                "co2": round(float(np.mean(b["co2"])), 2) if b["co2"] else None,
                "temperature": round(float(np.mean(b["temperature"])), 2) if b["temperature"] else None,
                "humidity": round(float(np.mean(b["humidity"])), 2) if b["humidity"] else None,
            }
        )
    return result

def fetch_data(minutes: int):
    if supabase is None:
        return {"rows": [], "raw_count": 0, "display_count": 0, "bucket_minutes": 1}

    since = (datetime.now(TZ) - timedelta(minutes=minutes)).isoformat()
    bucket_minutes = kies_bucket_minutes(minutes)
    rows = []
    offset = 0
    fetched_rows = 0

    while fetched_rows < MAX_FETCH_ROWS:
        remaining = MAX_FETCH_ROWS - fetched_rows
        page_size = min(SUPABASE_PAGE_SIZE, remaining)
        page_end = offset + page_size - 1

        resp = (
            supabase.table("air_quality")
            .select("created_at,co2,temperature,humidity")
            .gte("created_at", since)
            .order("created_at", desc=True)
            .range(offset, page_end)
            .execute()
        )
        chunk = resp.data or []
        if not chunk:
            break

        rows.extend(chunk)
        fetched_rows += len(chunk)
        if len(chunk) < page_size:
            break

        offset += len(chunk)

    rows = list(reversed(rows))
    rows = aggregateer_rows(rows, bucket_minutes)

    if len(rows) > MAX_POINTS:
        rows = rows[-MAX_POINTS:]

    return {
        "rows": rows,
        "raw_count": fetched_rows,
        "display_count": len(rows),
        "bucket_minutes": bucket_minutes,
    }


def unpack_store_data(data):
    if not data:
        return [], 0, 0
    if isinstance(data, list):
        # Backward compatibility with older store payloads.
        return data, len(data), len(data)

    rows = data.get("rows") or []
    raw_count = int(data.get("raw_count", len(rows)))
    display_count = int(data.get("display_count", len(rows)))
    return rows, raw_count, display_count


def to_ams(ts_str):
    return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).astimezone(TZ)

def rows_to_arrays(rows):
    """Zet Supabase rows om naar numpy arrays."""
    times = [to_ams(r["created_at"]) for r in rows]
    co2   = np.array([float(r["co2"])         for r in rows])
    temp  = np.array([float(r["temperature"]) for r in rows])
    rh    = np.array([float(r["humidity"])    for r in rows])
    return times, co2, temp, rh


# ══════════════════════════════════════════════════════
# BEREKENINGEN (uit notebook)
# ══════════════════════════════════════════════════════

def dewpoint(temp, rh):
    """Magnus-formule. Nauwkeurig ±0.35°C voor 0-60°C."""
    a, b = 17.625, 243.04
    gamma = (a * temp / (b + temp)) + np.log(np.clip(rh, 1, 100) / 100.0)
    return (b * gamma) / (a - gamma)

def wall_delta(hours):
    """Schatting wandtemperatuurverschil op basis van uur van de dag."""
    return 3.5 - 2.5 * np.sin((hours - 14) * np.pi / 12)

def mould_risk(temp, rh, wd):
    """Schimmelrisicoscore 0-100. >60 = risico, >80 = kritiek."""
    dp     = dewpoint(temp, rh)
    margin = (temp - wd) - dp
    return np.clip((5 - margin) / 8 * 100, 0, 100)

def bereken_tau_ach(times, co2):
    """CO2 decay-analyse → tau (tijdconstante) en ACH. Bouwbesluit norm: ACH >= 0.9"""
    if len(co2) < 30:
        return None

    from collections import defaultdict
    buckets = defaultdict(list)
    for t, c in zip(times, co2):
        key = t.replace(second=0, microsecond=0)
        key = key.replace(minute=(key.minute // 5) * 5)
        buckets[key].append(c)
    sorted_keys = sorted(buckets.keys())
    co2_5min = np.array([np.mean(buckets[k]) for k in sorted_keys])

    pieken, _ = find_peaks(co2_5min, height=1200, distance=60, prominence=300)

    tau_vals, ach_vals = [], []
    for pi in pieken:
        eind = min(pi + 24, len(co2_5min) - 1)
        seg  = co2_5min[pi:eind]
        if len(seg) < 8 or seg[-1] >= seg[0] - 300:
            continue
        t_min = np.arange(len(seg)) * 5.0
        try:
            popt, _ = curve_fit(
                lambda t, c0, c_amb, tau: c_amb + (c0 - c_amb) * np.exp(-t / tau),
                t_min, seg,
                p0=[seg[0], 450, 60],
                bounds=([400, 350, 5], [3000, 600, 300]),
                maxfev=2000
            )
            tau_vals.append(popt[2])
            ach_vals.append(60 / popt[2])
        except RuntimeError:
            pass

    if tau_vals:
        return {
            "n_events":    len(tau_vals),
            "tau_gem":     round(float(np.mean(tau_vals)), 1),
            "ach_gem":     round(float(np.mean(ach_vals)), 2),
            "ach_min":     round(float(np.min(ach_vals)),  2),
            "voldoet":     float(np.mean(ach_vals)) >= 0.9,
            "methode":     "curve_fit",
        }
    else:
        co2_gem = float(np.mean(co2))
        tau_s   = max(20, min(200, 60 * (co2_gem / 800)))
        ach_s   = round(60 / tau_s, 2)
        return {
            "n_events": 0,
            "tau_gem":  round(tau_s, 1),
            "ach_gem":  ach_s,
            "ach_min":  None,
            "voldoet":  ach_s >= 0.9,
            "methode":  "schatting (geen decay-events gevonden)",
        }

def bereken_cv_rh(times, rh):
    """Variatie-coëfficiënt RH. CV < 0.05 + hoge RH → lekkage."""
    if len(rh) < 2:
        return None
    cv      = float(np.std(rh) / np.mean(rh))
    gem_rh  = float(np.mean(rh))
    pct_70  = float(np.mean(rh > 70) * 100)
    if cv < 0.05 and gem_rh > 70:
        interpretatie = "LEKKAGE — constante vochtbron"
        kleur = RED
    elif cv > 0.08 and gem_rh < 65:
        interpretatie = "GEDRAG — activiteitspieken"
        kleur = AMBER
    elif gem_rh > 65:
        interpretatie = "BOUWKUNDIG — chronisch hoog"
        kleur = RED
    else:
        interpretatie = "NORMAAL"
        kleur = GREEN
    return {"cv": round(cv, 4), "gem_rh": round(gem_rh, 1),
            "pct_boven_70": round(pct_70, 1),
            "interpretatie": interpretatie, "kleur": kleur}

def detecteer_nacht_co2(times, co2):
    """Detecteer chronisch hoge nacht-CO2."""
    if len(co2) < 60:
        return None
    nacht_mask = np.array([(t.hour >= 23 or t.hour < 7) for t in times])
    dag_mask   = np.array([(9 <= t.hour < 17) for t in times])
    gem_nacht  = float(np.mean(co2[nacht_mask])) if nacht_mask.any() else 0
    gem_dag    = float(np.mean(co2[dag_mask]))   if dag_mask.any()   else 0
    ratio      = round(gem_nacht / gem_dag, 2)   if gem_dag > 0      else 1.0
    probleem   = gem_nacht > 1500 and ratio > 1.3
    return {
        "gem_nacht": round(gem_nacht),
        "gem_dag":   round(gem_dag),
        "ratio":     ratio,
        "probleem":  probleem,
        "advies":    "Raam op kier bij slapen" if probleem else "OK",
    }

def detecteer_seizoenstrend(times, mould):
    """Lineaire regressie op weekgemiddelden mould_risk."""
    if len(mould) < 24 * 7 * 2:
        return None
    from collections import defaultdict
    wk = defaultdict(list)
    for t, m in zip(times, mould):
        iso = t.isocalendar()
        wk[(iso.year, iso.week)].append(m)
    if len(wk) < 2:
        return None
    ordered = sorted(wk.items(), key=lambda item: item[0])
    week_labels = [f"{year}-W{week:02d}" for (year, week), _ in ordered]
    weken = [float(np.mean(vals)) for _, vals in ordered]
    x     = np.arange(len(weken))
    slope, _, r, p, _ = stats.linregress(x, weken)
    probleem = slope > 2.0 and p < 0.1
    return {
        "labels":   week_labels,
        "weken":    [round(v, 1) for v in weken],
        "helling":  round(float(slope), 2),
        "r2":       round(float(r**2), 3),
        "p":        round(float(p), 3),
        "probleem": probleem,
        "advies":   f"Risico stijgt {slope:.1f} punten/week — koudebrug?" if probleem else "Geen significante trend",
    }


def schat_resolutie_minuten(times):
    if len(times) < 2:
        return None
    deltas = []
    for i in range(1, len(times)):
        dt_sec = (times[i] - times[i - 1]).total_seconds()
        if dt_sec > 0:
            deltas.append(dt_sec / 60.0)
    if not deltas:
        return None
    return int(round(float(np.median(deltas))))


def bereken_voortschrijdend_gemiddelde(values, window_minutes: int, sample_interval_seconds: int = 60):
    """Berekenen voortschrijdend gemiddelde met gegeven window (minuten)."""
    if window_minutes <= 0 or len(values) < 2:
        return values
    
    sample_interval_minutes = sample_interval_seconds / 60.0
    window_samples = max(2, int(window_minutes / sample_interval_minutes))
    
    if window_samples >= len(values):
        return np.full_like(values, np.mean(values))
    
    smoothed = np.convolve(values, np.ones(window_samples) / window_samples, mode='same')
    
    for i in range(window_samples // 2):
        smoothed[i] = np.mean(values[:i + window_samples // 2 + 1])
        smoothed[-(i + 1)] = np.mean(values[-(i + window_samples // 2 + 1):])
    
    return smoothed


def bereken_langetermijntrend(times, values):
    if len(values) < 12:
        return None

    x_days = np.array([(t - times[0]).total_seconds() / 86400.0 for t in times], dtype=float)
    if x_days[-1] <= 0:
        return None

    slope, _, r, p, _ = stats.linregress(x_days, values)
    if np.isnan(slope):
        return None

    total_delta = float(slope * x_days[-1])
    return {
        "per_dag": float(slope),
        "delta_totaal": total_delta,
        "r2": float(r**2),
        "p": float(p),
    }


def trend_kwalificatie(delta, neutraal_band):
    if delta > neutraal_band:
        return "Stijgend", RED
    if delta < -neutraal_band:
        return "Dalend", GREEN
    return "Stabiel", AMBER


# ══════════════════════════════════════════════════════
# CHART HELPERS
# ══════════════════════════════════════════════════════

def empty_fig(msg="Nog geen data"):
    fig = go.Figure()
    fig.add_annotation(text=msg, xref="paper", yref="paper",
                       x=0.5, y=0.5, showarrow=False,
                       font=dict(size=13, color=MUTED))
    fig.update_layout(margin=dict(l=0,r=0,t=8,b=0),
                      paper_bgcolor=BG, plot_bgcolor=BG, height=200)
    return fig

AXIS_STYLE = dict(showgrid=True, gridcolor=BORDER, zeroline=False,
                  tickfont=dict(size=11, color=MUTED))

def line_fig(x, y, color, y_unit, height=200, ref_lines=None):
    fig = go.Figure(go.Scatter(
        x=x, y=np.round(y, 2),
        mode="lines",
        line=dict(color=color, width=1.8),
        hovertemplate=f"%{{x|%d %b %H:%M}}<br>%{{y:.1f}} {y_unit}<extra></extra>",
    ))
    if ref_lines:
        for val, label, col, dash in ref_lines:
            fig.add_hline(y=val, line_color=col, line_dash=dash,
                          line_width=1, annotation_text=label,
                          annotation_font_size=10)
    fig.update_layout(
        margin=dict(l=0,r=0,t=8,b=0),
        paper_bgcolor=BG, plot_bgcolor=BG, height=height,
        xaxis={**AXIS_STYLE, "tickformat": "%d %b\n%H:%M"},
        yaxis={**AXIS_STYLE, "title": dict(text=y_unit, font=dict(size=11, color=MUTED))},
    )
    return fig

def metric_card(title, value, unit, status_text=None, status_color=None, sub=None):
    accent = status_color if status_color else C_CO2
    return html.Div([
        html.P(title, style={
            "fontSize":"11px",
            "color":MUTED,
            "margin":"0 0 4px",
            "textTransform":"uppercase",
            "letterSpacing":"0.04em",
            "fontWeight":"700",
        }),
        html.P(value, style={
            "fontSize":"26px",
            "fontWeight":"700",
            "margin":"0",
            "color":TEXT,
            "fontFamily":"'Bricolage Grotesque', 'Avenir Next', 'Segoe UI', sans-serif",
        }),
        html.P(
            f"{unit}{(' — ' + status_text) if status_text else ''}",
            style={"fontSize":"11px","margin":"5px 0 0",
                   "color": status_color or MUTED}
        ),
        *(([html.P(sub, style={"fontSize":"10px","color":MUTED,"margin":"2px 0 0"})]) if sub else []),
    ], style={
        "background": "rgba(255,255,255,0.9)",
        "borderRadius":"14px",
        "border": f"1px solid {BORDER}",
        "boxShadow": "0 10px 22px rgba(17, 42, 70, 0.08)",
        "padding":"0.85rem 1rem",
        "flex":"1",
        "minWidth":"100px",
        "borderTop": f"3px solid {accent}",
    })

def status_badge(text, color):
    bg_map = {RED: "#FCEBEB", AMBER: "#FAEEDA", GREEN: "#EAF3DE"}
    return html.Span(text, style={
        "fontSize":"11px","padding":"3px 8px",
        "borderRadius":"4px","fontWeight":"500",
        "background": bg_map.get(color, SURFACE),
        "color": color,
    })


# ══════════════════════════════════════════════════════
# APP LAYOUT
# ══════════════════════════════════════════════════════

app = dash.Dash(
    __name__,
    title="Luchtkwaliteit",
    external_stylesheets=[
        "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=Manrope:wght@500;700&display=swap"
    ],
    meta_tags=[{"name":"viewport","content":"width=device-width,initial-scale=1"}],
)
server = app.server

app.layout = html.Div([
    dcc.Interval(id="interval", interval=60_000, n_intervals=0),
    dcc.Store(id="store"),
    dcc.Store(id="ma-store", data=0),

    html.Div([
        html.H1("Luchtkwaliteit", style={
            "fontSize":"30px",
            "fontWeight":"700",
            "lineHeight":"1",
            "letterSpacing":"-0.02em",
            "margin":"0",
            "color":TEXT,
            "fontFamily":"'Bricolage Grotesque', 'Avenir Next', 'Segoe UI', sans-serif",
        }),
        dcc.Dropdown(
            id="period", options=PERIOD_OPTIONS, value=1440, clearable=False,
            style={
                "width":"min(220px, 100%)",
                "minWidth":"170px",
                "flex":"1 1 220px",
                "fontSize":"13px",
                "fontWeight":"600",
            },
        ),
    ], style={
        "display":"flex",
        "flexWrap":"wrap",
        "alignItems":"center",
        "justifyContent":"space-between",
        "gap":"0.75rem",
        "marginBottom":"1.25rem",
    }),

    html.Div([
        html.P("Voortschrijdend gemiddelde", style={
            "fontSize":"12px",
            "color":MUTED,
            "margin":"0 0 10px",
            "fontWeight":"700",
            "textTransform":"uppercase",
            "letterSpacing":"0.03em",
        }),
        dcc.Slider(
            id="ma-slider",
            min=0, max=180, step=5, value=0,
            marks={0:"Ruw", 30:"30m", 60:"1u", 120:"2u", 180:"3u"},
            tooltip={"placement": "bottom", "always_visible": True},
        ),
            ], style={
             "marginBottom":"1.5rem",
             "padding":"0.9rem",
             "background":"rgba(255,255,255,0.88)",
             "borderRadius":"14px",
             "border":f"1px solid {BORDER}",
             "boxShadow":"0 10px 22px rgba(17, 42, 70, 0.06)",
            }),

    html.Div(id="metric-cards", style={"display":"flex","gap":"10px","marginBottom":"1.5rem","flexWrap":"wrap"}),

    dcc.Tabs(id="tabs", value="metingen", children=[
        dcc.Tab(label="Metingen",   value="metingen",   style=TAB_STYLE, selected_style=TAB_SELECTED),
        dcc.Tab(label="Dauwpunt & schimmel", value="schimmel", style=TAB_STYLE, selected_style=TAB_SELECTED),
        dcc.Tab(label="Ventilatie (τ / ACH)", value="ventilatie", style=TAB_STYLE, selected_style=TAB_SELECTED),
        dcc.Tab(label="Diagnose",   value="diagnose",   style=TAB_STYLE, selected_style=TAB_SELECTED),
    ], style={"marginBottom":"0.55rem", "overflowX":"auto", "whiteSpace":"nowrap", "paddingBottom":"4px"}),

    html.Div(id="tab-content", style={
        "border": f"1px solid {BORDER}",
        "borderRadius":"14px",
        "padding":"1.35rem",
        "background": "rgba(255,255,255,0.92)",
        "boxShadow":"0 14px 30px rgba(17, 42, 70, 0.08)",
        "marginBottom":"1rem",
    }),

    html.P(id="footer", style={"fontSize":"11px","color":MUTED,"marginTop":"0.6rem","fontWeight":"600"}),

], style={
    "fontFamily": "'Manrope', 'Avenir Next', 'Segoe UI', sans-serif",
    "maxWidth": "980px", "margin": "0 auto",
    "padding": "1.6rem 1.2rem",
    "background": "rgba(248, 246, 240, 0.62)",
    "backdropFilter": "blur(3px)",
    "animation": "riseIn 0.55s ease-out",
    "minHeight": "100vh",
    "color": TEXT,
}, id="app-shell")


# ══════════════════════════════════════════════════════
# CALLBACKS
# ══════════════════════════════════════════════════════

@callback(Output("store", "data"),
          Input("period", "value"),
          Input("interval", "n_intervals"))
def load_data(period_minutes, _):
    return fetch_data(period_minutes)


@callback(Output("ma-store", "data"),
          Input("ma-slider", "value"))
def update_moving_avg_window(slider_value):
    """Update moving average window from the slider."""
    return slider_value


@callback(
    Output("metric-cards", "children"),
    Output("footer", "children"),
    Input("store", "data"),
)
def update_cards(store_data):
    rows, raw_count, display_count = unpack_store_data(store_data)
    if not rows:
        reason = "Geen data"
        if SUPABASE_INIT_ERROR:
            reason = f"Geen data: Supabase configuratie fout ({SUPABASE_INIT_ERROR})"
        return [metric_card("CO₂","—","ppm"), metric_card("Temperatuur","—","°C"),
                metric_card("Luchtvochtigheid","—","%")], reason

    times, co2, temp, rh = rows_to_arrays(rows)
    hours = np.array([t.hour + t.minute/60 for t in times])
    wd    = wall_delta(hours)
    mr    = mould_risk(temp, rh, wd)

    latest_co2  = round(float(co2[-1]))
    latest_temp = round(float(temp[-1]), 1)
    latest_rh   = round(float(rh[-1]),   1)
    latest_mr   = round(float(mr[-1]),   1)
    latest_dp   = round(float(dewpoint(temp[-1], rh[-1])), 1)

    if latest_co2 < 800:   co2_status, co2_col = "Goed",             GREEN
    elif latest_co2 < 1000: co2_status, co2_col = "Matig",            AMBER
    else:                   co2_status, co2_col = "Slecht — ventileer!", RED

    if latest_mr > 80:   mr_status, mr_col = "Kritiek", RED
    elif latest_mr > 60: mr_status, mr_col = "Risico",  AMBER
    else:                mr_status, mr_col = "OK",       GREEN

    ach_data = bereken_tau_ach(times, co2)
    ach_str  = f"{ach_data['ach_gem']:.2f}" if ach_data else "—"
    ach_col  = (GREEN if ach_data and ach_data["voldoet"] else RED) if ach_data else MUTED
    ach_status = ("OK" if ach_data and ach_data["voldoet"] else "Onder norm") if ach_data else ""

    cards = [
        metric_card("CO₂",               str(latest_co2),  "ppm",  co2_status,  co2_col),
        metric_card("Temperatuur",        str(latest_temp), "°C"),
        metric_card("Luchtvochtigheid",   str(latest_rh),   "%"),
        metric_card("Dauwpunt",           str(latest_dp),   "°C"),
        metric_card("Schimmelrisico",     str(latest_mr),   "/100", mr_status,   mr_col),
        metric_card("ACH (ventilatie)",   ach_str,          "luchtv./u", ach_status, ach_col,
                    sub=f"τ = {ach_data['tau_gem']} min" if ach_data else None),
        metric_card("Metingen",           str(raw_count),   "in periode",
                    sub=f"{display_count} grafiekpunten"),
    ]

    ts = times[-1]
    footer = f"Laatste meting: {ts.strftime('%d %b %Y %H:%M')} · vernieuwt automatisch elke minuut"
    return cards, footer


@callback(Output("tab-content", "children"),
          Input("tabs", "value"),
          Input("store", "data"),
          Input("ma-store", "data"))
def render_tab(tab, store_data, ma_window):
    rows, _, _ = unpack_store_data(store_data)
    if not rows:
        return html.P("Nog geen data in geselecteerde periode.", style={"color": MUTED})

    times, co2, temp, rh = rows_to_arrays(rows)
    resolutie_min = schat_resolutie_minuten(times)
    hours = np.array([t.hour + t.minute/60 for t in times])
    wd    = wall_delta(hours)
    dp    = dewpoint(temp, rh)
    mr    = mould_risk(temp, rh, wd)
    
    if ma_window > 0 and len(times) > 1:
        sample_interval = int((times[-1] - times[0]).total_seconds() / (len(times) - 1)) if len(times) > 1 else 60
        co2  = bereken_voortschrijdend_gemiddelde(co2, ma_window, sample_interval)
        temp = bereken_voortschrijdend_gemiddelde(temp, ma_window, sample_interval)
        rh   = bereken_voortschrijdend_gemiddelde(rh, ma_window, sample_interval)
        dp   = bereken_voortschrijdend_gemiddelde(dp, ma_window, sample_interval)
        mr   = bereken_voortschrijdend_gemiddelde(mr, ma_window, sample_interval)

    if tab == "metingen":
        resolutie_info = []
        if resolutie_min and resolutie_min > 1:
            resolutie_info = [
                html.P(
                    f"Trendmodus actief: data geaggregeerd op ongeveer {resolutie_min} minuten per punt.",
                    style={"fontSize":"11px", "color":MUTED, "margin":"6px 0 0"},
                )
            ]

        return html.Div([
            html.P("CO₂ (ppm)", style={"fontSize":"13px","color":MUTED,"margin":"0 0 6px"}),
            dcc.Graph(figure=line_fig(times, co2, C_CO2, "ppm",
                ref_lines=[(1000,"Bouwbesluit",AMBER,"dot"),(800,"Aanbevolen",GREEN,"dot")]),
                config={"displayModeBar":False}),
            html.P("Temperatuur (°C)", style={"fontSize":"13px","color":MUTED,"margin":"1rem 0 6px"}),
            dcc.Graph(figure=line_fig(times, temp, C_TEMP, "°C"),
                config={"displayModeBar":False}),
            html.P("Luchtvochtigheid (%)", style={"fontSize":"13px","color":MUTED,"margin":"1rem 0 6px"}),
            dcc.Graph(figure=line_fig(times, rh, C_RH, "%",
                ref_lines=[(70,"Schimmelgrens",RED,"dash"),(60,"Attentie",AMBER,"dot")]),
                config={"displayModeBar":False}),
            *resolutie_info,
        ])

    elif tab == "schimmel":
        fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                            row_heights=[0.45, 0.55], vertical_spacing=0.08)
        fig.add_trace(go.Scatter(x=times, y=np.round(temp, 2), name="Temperatuur",
                                 line=dict(color=C_TEMP, width=1.5)), row=1, col=1)
        fig.add_trace(go.Scatter(x=times, y=np.round(dp, 2), name="Dauwpunt",
                                 line=dict(color=C_CO2, width=1.5, dash="dot")), row=1, col=1)
        fig.add_trace(go.Scatter(
            x=times, y=np.round(mr, 1), name="Schimmelrisico",
            fill="tozeroy",
            line=dict(color=C_MOULD, width=1.5),
            fillcolor="rgba(226,75,74,0.15)",
        ), row=2, col=1)
        fig.add_hline(y=80, line_color=RED,   line_dash="dash", line_width=1,
                      annotation_text="Kritiek (80)", annotation_font_size=10, row=2, col=1)
        fig.add_hline(y=60, line_color=AMBER, line_dash="dot",  line_width=1,
                      annotation_text="Risico (60)",  annotation_font_size=10, row=2, col=1)
        fig.update_layout(
            height=380, margin=dict(l=0,r=0,t=8,b=0),
            paper_bgcolor=BG, plot_bgcolor=BG,
            legend=dict(orientation="h", y=1.06, x=0, font=dict(size=11)),
            xaxis2={**AXIS_STYLE, "tickformat":"%d %b\n%H:%M"},
            yaxis={**AXIS_STYLE,  "title": dict(text="°C", font=dict(size=11, color=MUTED))},
            yaxis2={**AXIS_STYLE, "title": dict(text="Score 0-100", font=dict(size=11, color=MUTED)),
                    "range": [0, 105]},
        )

        pct_60 = round(float(np.mean(mr > 60) * 100), 1)
        pct_80 = round(float(np.mean(mr > 80) * 100), 1)
        gem_dp = round(float(np.mean(dp)), 1)

        return html.Div([
            html.Div([
                metric_card("Gem. dauwpunt", str(gem_dp), "°C"),
                metric_card("Risico > 60", f"{pct_60}%", "van de tijd",
                            "Let op" if pct_60 > 10 else "OK",
                            AMBER if pct_60 > 10 else GREEN),
                metric_card("Kritiek > 80", f"{pct_80}%", "van de tijd",
                            "Kritiek" if pct_80 > 5 else "OK",
                            RED if pct_80 > 5 else GREEN),
            ], style={"display":"flex","gap":"10px","marginBottom":"1rem","flexWrap":"wrap"}),
            dcc.Graph(figure=fig, config={"displayModeBar":False}),
            html.P("Formule: Magnus (Lawrence 2005) · Wandtemperatuur geschat op basis van uur van de dag",
                   style={"fontSize":"11px","color":MUTED,"marginTop":"8px"}),
        ])

    elif tab == "ventilatie":
        ach_data = bereken_tau_ach(times, co2)
        nacht    = detecteer_nacht_co2(times, co2)

        fig = line_fig(times, co2, C_CO2, "ppm", height=220,
                       ref_lines=[(1000,"Bouwbesluit",AMBER,"dot")])
        if ach_data:
            fig.add_annotation(
                xref="paper", yref="paper", x=0.01, y=0.97,
                text=f"ACH = {ach_data['ach_gem']:.2f} | τ = {ach_data['tau_gem']} min | {ach_data['methode']}",
                showarrow=False, font=dict(size=11, color=TEXT),
                bgcolor=SURFACE, borderpad=4,
            )

        ach_col    = (GREEN if ach_data and ach_data["voldoet"] else RED) if ach_data else MUTED
        ach_status = ("✓ Voldoet aan Bouwbesluit (≥ 0.9)" if ach_data and ach_data["voldoet"]
                      else "✗ Onder Bouwbesluit norm (< 0.9)") if ach_data else "—"

        nacht_items = []
        if nacht:
            nacht_col = RED if nacht["probleem"] else GREEN
            nacht_items = [
                html.Div([
                    html.P("Nacht-CO₂ analyse", style={"fontSize":"13px","fontWeight":"500",
                            "color":TEXT,"margin":"1rem 0 8px"}),
                    html.Div([
                        metric_card("Nacht gem.", str(nacht["gem_nacht"]), "ppm",
                                    "Te hoog" if nacht["probleem"] else "OK", nacht_col),
                        metric_card("Dag gem.",   str(nacht["gem_dag"]),   "ppm"),
                        metric_card("Nacht/dag ratio", str(nacht["ratio"]), "×",
                                    "Ventileer bij slapen" if nacht["probleem"] else "OK", nacht_col),
                    ], style={"display":"flex","gap":"10px","flexWrap":"wrap"}),
                    *(([html.Div([
                        html.Span("⚠ ", style={"color":RED}),
                        html.Span(nacht["advies"], style={"fontSize":"13px","color":RED}),
                    ], style={"marginTop":"8px"})]) if nacht["probleem"] else []),
                ])
            ]

        return html.Div([
            html.Div([
                metric_card("ACH",   str(ach_data["ach_gem"]) if ach_data else "—",
                            "luchtverv./uur", ach_status, ach_col),
                metric_card("τ (tau)", str(ach_data["tau_gem"]) if ach_data else "—",
                            "minuten", "Grens: 67 min", MUTED),
                metric_card("Decay events", str(ach_data["n_events"]) if ach_data else "—",
                            "gevonden"),
            ], style={"display":"flex","gap":"10px","marginBottom":"1rem","flexWrap":"wrap"}),
            dcc.Graph(figure=fig, config={"displayModeBar":False}),
            html.P("Formule: C(t) = C_buiten + (C_piek − C_buiten) × exp(−t/τ) · ACH = 60/τ · Bouwbesluit: ACH ≥ 0.9",
                   style={"fontSize":"11px","color":MUTED,"marginTop":"8px"}),
            *nacht_items,
        ])

    elif tab == "diagnose":
        cv       = bereken_cv_rh(times, rh)
        ach_data = bereken_tau_ach(times, co2)
        nacht    = detecteer_nacht_co2(times, co2)
        seizoen  = detecteer_seizoenstrend(times, mr)
        co2_trend = bereken_langetermijntrend(times, co2)
        rh_trend = bereken_langetermijntrend(times, rh)
        mr_trend = bereken_langetermijntrend(times, mr)

        pct_mr60 = round(float(np.mean(mr > 60) * 100), 1)
        gem_rh   = round(float(np.mean(rh)), 1)

        bevindingen = []
        conclusie_tekst = "Geen structureel probleem vastgesteld"
        conclusie_kleur = GREEN

        if cv and "LEKKAGE" in cv["interpretatie"]:
            bevindingen.append(("Verborgen lekkage (constante vochtbron)", RED))
            conclusie_tekst = "Bouwkundig gebrek — verhuurder verantwoordelijk"
            conclusie_kleur = RED
        if pct_mr60 > 30:
            bevindingen.append((f"Schimmelrisico > 60 op {pct_mr60}% van de tijd", RED))
            conclusie_tekst = "Bouwkundig gebrek — verhuurder verantwoordelijk"
            conclusie_kleur = RED
        if cv and "BOUWKUNDIG" in cv["interpretatie"]:
            bevindingen.append(("Chronisch hoge RH zonder duidelijke pieken", RED))
        if cv and "GEDRAG" in cv["interpretatie"]:
            bevindingen.append(("Activiteitspieken in RH — bewonersgedrag", AMBER))
            if conclusie_kleur != RED:
                conclusie_tekst = "Bewonersgedrag dominant — ventilatie-advies"
                conclusie_kleur = AMBER
        if ach_data and not ach_data["voldoet"]:
            bevindingen.append((f"ACH = {ach_data['ach_gem']} — onder Bouwbesluit norm (0.9)", AMBER))
        if nacht and nacht["probleem"]:
            bevindingen.append(("Nacht-CO₂ structureel hoog — raam dicht bij slapen", AMBER))
        if seizoen and seizoen["probleem"]:
            bevindingen.append((f"Seizoenstrend: {seizoen['advies']}", AMBER))
        if co2_trend and co2_trend["p"] < 0.1 and co2_trend["delta_totaal"] > 120:
            bevindingen.append((f"CO₂ trend stijgend (+{co2_trend['delta_totaal']:.0f} ppm in periode)", RED))
        if rh_trend and rh_trend["p"] < 0.1 and rh_trend["delta_totaal"] > 4:
            bevindingen.append((f"Luchtvochtigheid loopt op (+{rh_trend['delta_totaal']:.1f}%)", AMBER))
        if mr_trend and mr_trend["p"] < 0.1 and mr_trend["delta_totaal"] > 8:
            bevindingen.append((f"Schimmelrisico trend stijgend (+{mr_trend['delta_totaal']:.1f} punten)", RED))

        aanbevelingen = []
        if pct_mr60 > 30:
            aanbevelingen.append("Thermografisch onderzoek aanbevolen (koudebruggen lokaliseren)")
        if cv and "LEKKAGE" in cv["interpretatie"]:
            aanbevelingen.append("Vochtmeting achter wanden aanbevolen (bouwkundig onderzoek)")
        if cv and "GEDRAG" in cv["interpretatie"]:
            aanbevelingen.append("Verhoog ventilatie na douchen (minimaal 30 min mechanische afzuiging)")
        if ach_data and not ach_data["voldoet"]:
            aanbevelingen.append("CO₂ structureel hoog — ventilatiessysteem controleren of raam op kier bij slapen")
        if nacht and nacht["probleem"]:
            aanbevelingen.append("Raam op kier bij slapen — CO₂ loopt 's nachts structureel op boven 1500 ppm")
        if co2_trend and co2_trend["delta_totaal"] > 120:
            aanbevelingen.append("Controleer ventilatiesysteem op structureel teruglopende afvoer of aanvoer")
        if rh_trend and rh_trend["delta_totaal"] > 4:
            aanbevelingen.append("Plan seizoenscontrole op vochtbronnen (badkamer, kruipruimte, koudebruggen)")

        seizoen_graf = []
        if seizoen and len(seizoen["weken"]) >= 2:
            fig_s = go.Figure(go.Bar(
                x=seizoen["labels"],
                y=seizoen["weken"],
                marker_color=[RED if v > 60 else AMBER if v > 40 else GREEN
                              for v in seizoen["weken"]],
            ))
            fig_s.add_hline(y=60, line_color=RED, line_dash="dash", line_width=1,
                            annotation_text="Risicodrempel (60)")
            fig_s.update_layout(
                height=180, margin=dict(l=0,r=0,t=8,b=0),
                paper_bgcolor=BG, plot_bgcolor=BG,
                xaxis=AXIS_STYLE, yaxis={**AXIS_STYLE, "range":[0,105]},
            )
            seizoen_graf = [
                html.P("Schimmelrisico per week", style={"fontSize":"13px","color":MUTED,"margin":"1rem 0 6px"}),
                dcc.Graph(figure=fig_s, config={"displayModeBar":False}),
                html.P(f"Trend: {seizoen['advies']} (R² = {seizoen['r2']}, p = {seizoen['p']})",
                       style={"fontSize":"11px","color": RED if seizoen["probleem"] else MUTED,
                              "marginTop":"6px"}),
            ]

        trend_blok = []
        if co2_trend or rh_trend or mr_trend:
            trend_cards = []
            if co2_trend:
                label, kleur = trend_kwalificatie(co2_trend["delta_totaal"], 50)
                trend_cards.append(
                    metric_card(
                        "CO₂ trend",
                        f"{co2_trend['delta_totaal']:+.0f}",
                        "ppm/periode",
                        label,
                        kleur,
                        sub=f"{co2_trend['per_dag']:+.1f} ppm/dag",
                    )
                )
            if rh_trend:
                label, kleur = trend_kwalificatie(rh_trend["delta_totaal"], 2.0)
                trend_cards.append(
                    metric_card(
                        "RH trend",
                        f"{rh_trend['delta_totaal']:+.1f}",
                        "%/periode",
                        label,
                        kleur,
                        sub=f"{rh_trend['per_dag']:+.2f} %/dag",
                    )
                )
            if mr_trend:
                label, kleur = trend_kwalificatie(mr_trend["delta_totaal"], 5.0)
                trend_cards.append(
                    metric_card(
                        "Schimmelrisico trend",
                        f"{mr_trend['delta_totaal']:+.1f}",
                        "punten/periode",
                        label,
                        kleur,
                        sub=f"{mr_trend['per_dag']:+.2f} p/dag",
                    )
                )

            trend_blok = [
                html.P("Langetermijntrends", style={"fontSize":"13px","fontWeight":"500","color":TEXT,"margin":"0 0 8px"}),
                html.Div(trend_cards, style={"display":"flex","gap":"10px","marginBottom":"1rem","flexWrap":"wrap"}),
            ]

        return html.Div([
            html.Div([
                html.P("Conclusie", style={"fontSize":"11px","color":MUTED,"margin":"0 0 4px"}),
                html.P(conclusie_tekst, style={"fontSize":"16px","fontWeight":"500",
                                               "color":conclusie_kleur,"margin":"0"}),
            ], style={"background":SURFACE,"borderRadius":"8px","padding":"1rem",
                      "marginBottom":"1rem","borderLeft":f"3px solid {conclusie_kleur}"}),

            *(([html.Div([
                html.P("Bevindingen", style={"fontSize":"13px","fontWeight":"500","color":TEXT,"margin":"0 0 8px"}),
                *[html.Div([
                    html.Span("● ", style={"color":kleur}),
                    html.Span(tekst, style={"fontSize":"13px","color":TEXT}),
                ], style={"marginBottom":"4px"}) for tekst, kleur in bevindingen],
            ], style={"marginBottom":"1rem"})]) if bevindingen else [
                html.P("Geen afwijkingen gedetecteerd in de geselecteerde periode.",
                       style={"fontSize":"13px","color":MUTED,"marginBottom":"1rem"}),
            ]),

            html.Div([
                metric_card("RH gem.",           str(gem_rh),       "%"),
                metric_card("CV (RH)",           str(cv["cv"]) if cv else "—", "",
                            cv["interpretatie"] if cv else "", cv["kleur"] if cv else MUTED),
                metric_card("Mould risk > 60",   f"{pct_mr60}%",    "v/d tijd",
                            "Risico" if pct_mr60 > 10 else "OK",
                            RED if pct_mr60 > 30 else AMBER if pct_mr60 > 10 else GREEN),
                metric_card("ACH",               str(ach_data["ach_gem"]) if ach_data else "—",
                            "luchtv./u",
                            "OK" if ach_data and ach_data["voldoet"] else "Onder norm",
                            GREEN if ach_data and ach_data["voldoet"] else RED),
            ], style={"display":"flex","gap":"10px","marginBottom":"1rem","flexWrap":"wrap"}),

            *trend_blok,

            *(([html.Div([
                html.P("Aanbevelingen", style={"fontSize":"13px","fontWeight":"500","color":TEXT,"margin":"0 0 8px"}),
                *[html.P(f"{i+1}. {a}", style={"fontSize":"13px","color":TEXT,"margin":"0 0 4px"})
                  for i, a in enumerate(aanbevelingen)],
            ], style={"marginBottom":"1rem"})]) if aanbevelingen else []),

            *seizoen_graf,
        ])

    return html.P("Onbekende tab", style={"color": MUTED})


if __name__ == "__main__":
    app.run(host=APP_HOST, port=APP_PORT, debug=APP_DEBUG)
