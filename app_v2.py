import os
import numpy as np
from datetime import datetime, timedelta
from scipy.optimize import curve_fit
from scipy.signal import find_peaks
from scipy import stats
import zoneinfo

import dash
from dash import dcc, html, Input, Output, callback
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from supabase import create_client

# ── Config ────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://kqzknfjkihbzkwqjlrsk.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxemtuZmpraWhiemt3cWpscnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTM3OTgsImV4cCI6MjA2NDA4OTc5OH0.0ePUrY8YkcWePg-wihrs5-wkxUmSTrEkEedV15adRNQ")
TZ = zoneinfo.ZoneInfo("Europe/Amsterdam")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Kleuren ───────────────────────────────────────────
C_CO2   = "#185FA5"
C_TEMP  = "#993C1D"
C_RH    = "#0F6E56"
C_MOULD = "#E24B4A"
C_VOC   = "#7F77DD"
BG      = "#ffffff"
SURFACE = "#f5f5f3"
BORDER  = "rgba(0,0,0,0.08)"
TEXT    = "#2c2c2a"
MUTED   = "#888780"
RED     = "#E24B4A"
AMBER   = "#BA7517"
GREEN   = "#3B6D11"

PERIOD_OPTIONS = [
    {"label": "Laatste 30 min",  "value": 30},
    {"label": "Laatste uur",     "value": 60},
    {"label": "Laatste 6 uur",   "value": 360},
    {"label": "Laatste 24 uur",  "value": 1440},
    {"label": "Laatste 7 dagen", "value": 10080},
    {"label": "Laatste 30 dagen","value": 43200},
]

TAB_STYLE = {
    "padding": "8px 16px",
    "fontSize": "13px",
    "color": MUTED,
    "border": f"0.5px solid {BORDER}",
    "borderBottom": "none",
    "background": SURFACE,
    "borderRadius": "8px 8px 0 0",
    "marginRight": "4px",
}
TAB_SELECTED = {**TAB_STYLE, "color": TEXT, "background": BG, "fontWeight": "500"}


# ══════════════════════════════════════════════════════
# DATA OPHALEN
# ══════════════════════════════════════════════════════

def fetch_data(minutes: int):
    since = (datetime.now(TZ) - timedelta(minutes=minutes)).isoformat()
    resp = (
        supabase.table("air_quality")
        .select("created_at,co2,temperature,humidity")
        .gte("created_at", since)
        .order("created_at", desc=False)
        .limit(10000)
        .execute()
    )
    return resp.data or []

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
    """
    CO2 decay-analyse → tau (tijdconstante) en ACH.
    Bouwbesluit norm: ACH >= 0.9
    """
    if len(co2) < 30:
        return None

    # Resample naar 5-minuutsgemiddelden
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
        # Ruwe schatting op basis van gem. CO2
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
    """Detecteer chronisch hoge nacht-CO2 (scenario G)."""
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
    """Lineaire regressie op weekgemiddelden mould_risk (scenario L)."""
    if len(mould) < 24 * 7 * 2:  # Minstens 2 weken
        return None
    # Weekgemiddelden
    from collections import defaultdict
    wk = defaultdict(list)
    for t, m in zip(times, mould):
        wk[t.isocalendar()[1]].append(m)
    if len(wk) < 2:
        return None
    weken = [float(np.mean(v)) for v in sorted(wk.values(), key=lambda _: _)]
    x     = np.arange(len(weken))
    slope, _, r, p, _ = stats.linregress(x, weken)
    probleem = slope > 2.0 and p < 0.1
    return {
        "weken":    [round(v, 1) for v in weken],
        "helling":  round(float(slope), 2),
        "r2":       round(float(r**2), 3),
        "p":        round(float(p), 3),
        "probleem": probleem,
        "advies":   f"Risico stijgt {slope:.1f} punten/week — koudebrug?" if probleem else "Geen significante trend",
    }


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
    return html.Div([
        html.P(title, style={"fontSize":"12px","color":MUTED,"margin":"0 0 4px"}),
        html.P(value, style={"fontSize":"22px","fontWeight":"500","margin":"0","color":TEXT}),
        html.P(
            f"{unit}{(' — ' + status_text) if status_text else ''}",
            style={"fontSize":"11px","margin":"4px 0 0",
                   "color": status_color or MUTED}
        ),
        *(([html.P(sub, style={"fontSize":"10px","color":MUTED,"margin":"2px 0 0"})]) if sub else []),
    ], style={
        "background": SURFACE, "borderRadius":"8px",
        "padding":"0.75rem 1rem", "flex":"1", "minWidth":"100px",
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
    meta_tags=[{"name":"viewport","content":"width=device-width,initial-scale=1"}],
)
server = app.server

app.layout = html.Div([
    dcc.Interval(id="interval", interval=60_000, n_intervals=0),
    dcc.Store(id="store"),  # gecachte data

    # Header
    html.Div([
        html.H1("Luchtkwaliteit", style={"fontSize":"20px","fontWeight":"500","margin":"0","color":TEXT}),
        dcc.Dropdown(
            id="period", options=PERIOD_OPTIONS, value=1440, clearable=False,
            style={"width":"180px","fontSize":"13px"},
        ),
    ], style={"display":"flex","alignItems":"center","justifyContent":"space-between","marginBottom":"1.5rem"}),

    # Metric cards
    html.Div(id="metric-cards", style={"display":"flex","gap":"10px","marginBottom":"1.5rem","flexWrap":"wrap"}),

    # Tabs
    dcc.Tabs(id="tabs", value="metingen", children=[
        dcc.Tab(label="Metingen",   value="metingen",   style=TAB_STYLE, selected_style=TAB_SELECTED),
        dcc.Tab(label="Dauwpunt & schimmel", value="schimmel", style=TAB_STYLE, selected_style=TAB_SELECTED),
        dcc.Tab(label="Ventilatie (τ / ACH)", value="ventilatie", style=TAB_STYLE, selected_style=TAB_SELECTED),
        dcc.Tab(label="Diagnose",   value="diagnose",   style=TAB_STYLE, selected_style=TAB_SELECTED),
    ], style={"marginBottom":"0"}),

    html.Div(id="tab-content", style={
        "border": f"0.5px solid {BORDER}", "borderRadius":"0 8px 8px 8px",
        "padding":"1.5rem", "background": BG, "marginBottom":"1rem",
    }),

    html.P(id="footer", style={"fontSize":"11px","color":MUTED,"marginTop":"0.5rem"}),

], style={
    "fontFamily": "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "maxWidth": "900px", "margin": "0 auto",
    "padding": "2rem 1.5rem", "background": BG, "minHeight": "100vh",
})


# ══════════════════════════════════════════════════════
# CALLBACKS
# ══════════════════════════════════════════════════════

@callback(Output("store", "data"),
          Input("period", "value"),
          Input("interval", "n_intervals"))
def load_data(period_minutes, _):
    return fetch_data(period_minutes)


@callback(
    Output("metric-cards", "children"),
    Output("footer", "children"),
    Input("store", "data"),
)
def update_cards(rows):
    if not rows:
        return [metric_card("CO₂","—","ppm"), metric_card("Temperatuur","—","°C"),
                metric_card("Luchtvochtigheid","—","%")], "Geen data"

    times, co2, temp, rh = rows_to_arrays(rows)
    hours = np.array([t.hour + t.minute/60 for t in times])
    wd    = wall_delta(hours)
    mr    = mould_risk(temp, rh, wd)

    latest_co2  = round(float(co2[-1]))
    latest_temp = round(float(temp[-1]), 1)
    latest_rh   = round(float(rh[-1]),   1)
    latest_mr   = round(float(mr[-1]),   1)
    latest_dp   = round(float(dewpoint(temp[-1], rh[-1])), 1)

    # CO2 status
    if latest_co2 < 800:   co2_status, co2_col = "Goed",             GREEN
    elif latest_co2 < 1000: co2_status, co2_col = "Matig",            AMBER
    else:                   co2_status, co2_col = "Slecht — ventileer!", RED

    # Mould status
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
        metric_card("Metingen",           str(len(rows)),   "in periode"),
    ]

    ts = times[-1]
    footer = f"Laatste meting: {ts.strftime('%d %b %Y %H:%M')} · vernieuwt automatisch elke minuut"
    return cards, footer


@callback(Output("tab-content", "children"),
          Input("tabs", "value"),
          Input("store", "data"))
def render_tab(tab, rows):
    if not rows:
        return html.P("Nog geen data in geselecteerde periode.", style={"color": MUTED})

    times, co2, temp, rh = rows_to_arrays(rows)
    hours = np.array([t.hour + t.minute/60 for t in times])
    wd    = wall_delta(hours)
    dp    = dewpoint(temp, rh)
    mr    = mould_risk(temp, rh, wd)

    # ── Tab: Metingen ────────────────────────────────
    if tab == "metingen":
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
        ])

    # ── Tab: Dauwpunt & schimmel ──────────────────────
    elif tab == "schimmel":
        fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                            row_heights=[0.45, 0.55], vertical_spacing=0.08)
        fig.add_trace(go.Scatter(x=times, y=np.round(temp, 2), name="Temperatuur",
                                 line=dict(color=C_TEMP, width=1.5)), row=1, col=1)
        fig.add_trace(go.Scatter(x=times, y=np.round(dp, 2), name="Dauwpunt",
                                 line=dict(color=C_CO2, width=1.5, dash="dot")), row=1, col=1)
        # Schimmelrisico met kleurvulling
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

    # ── Tab: Ventilatie τ / ACH ───────────────────────
    elif tab == "ventilatie":
        ach_data = bereken_tau_ach(times, co2)
        nacht    = detecteer_nacht_co2(times, co2)

        # CO2 grafiek met ACH annotatie
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

    # ── Tab: Diagnose ─────────────────────────────────
    elif tab == "diagnose":
        cv       = bereken_cv_rh(times, rh)
        ach_data = bereken_tau_ach(times, co2)
        nacht    = detecteer_nacht_co2(times, co2)
        seizoen  = detecteer_seizoenstrend(times, mr)

        pct_mr60 = round(float(np.mean(mr > 60) * 100), 1)
        gem_rh   = round(float(np.mean(rh)), 1)

        # Conclusie
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

        # Seizoensgrafiek
        seizoen_graf = []
        if seizoen and len(seizoen["weken"]) >= 2:
            fig_s = go.Figure(go.Bar(
                x=[f"Week {i+1}" for i in range(len(seizoen["weken"]))],
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

        return html.Div([
            # Conclusie banner
            html.Div([
                html.P("Conclusie", style={"fontSize":"11px","color":MUTED,"margin":"0 0 4px"}),
                html.P(conclusie_tekst, style={"fontSize":"16px","fontWeight":"500",
                                               "color":conclusie_kleur,"margin":"0"}),
            ], style={"background":SURFACE,"borderRadius":"8px","padding":"1rem",
                      "marginBottom":"1rem","borderLeft":f"3px solid {conclusie_kleur}"}),

            # Bevindingen
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

            # Metrics overzicht
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

            # Aanbevelingen
            *(([html.Div([
                html.P("Aanbevelingen", style={"fontSize":"13px","fontWeight":"500","color":TEXT,"margin":"0 0 8px"}),
                *[html.P(f"{i+1}. {a}", style={"fontSize":"13px","color":TEXT,"margin":"0 0 4px"})
                  for i, a in enumerate(aanbevelingen)],
            ], style={"marginBottom":"1rem"})]) if aanbevelingen else []),

            *seizoen_graf,
        ])

    return html.P("Onbekende tab", style={"color": MUTED})


if __name__ == "__main__":
    app.run(debug=True)
