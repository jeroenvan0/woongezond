import os
from datetime import datetime, timedelta
import zoneinfo

import dash
from dash import dcc, html, Input, Output, callback
import plotly.graph_objects as go
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://kqzknfjkihbzkwqjlrsk.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxemtuZmpraWhiemt3cWpscnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTM3OTgsImV4cCI6MjA2NDA4OTc5OH0.0ePUrY8YkcWePg-wihrs5-wkxUmSTrEkEedV15adRNQ")

TZ = zoneinfo.ZoneInfo("Europe/Amsterdam")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

C_CO2   = "#185FA5"
C_TEMP  = "#993C1D"
C_RH    = "#0F6E56"
BG      = "#ffffff"
SURFACE = "#f5f5f3"
BORDER  = "rgba(0,0,0,0.08)"
TEXT    = "#2c2c2a"
MUTED   = "#888780"

PERIOD_OPTIONS = [
    {"label": "Laatste 30 min", "value": 30},
    {"label": "Laatste uur",    "value": 60},
    {"label": "Laatste 6 uur",  "value": 360},
    {"label": "Laatste 24 uur", "value": 1440},
    {"label": "Laatste 7 dagen","value": 10080},
]

def fetch_data(minutes: int):
    since = (datetime.now(TZ) - timedelta(minutes=minutes)).isoformat()
    resp = (
        supabase.table("air_quality")
        .select("created_at,co2,temperature,humidity")
        .gte("created_at", since)
        .order("created_at", desc=False)
        .limit(5000)
        .execute()
    )
    return resp.data or []

def to_amsterdam(ts_str):
    return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).astimezone(TZ)

def co2_status(ppm):
    if ppm < 800:
        return "Goed", "#3B6D11"
    if ppm < 1000:
        return "Matig", "#BA7517"
    return "Slecht — ventileer!", "#A32D2D"

def make_line_chart(rows, field, color, y_label, y_unit):
    if not rows:
        fig = go.Figure()
        fig.add_annotation(text="Nog geen data", xref="paper", yref="paper",
                           x=0.5, y=0.5, showarrow=False,
                           font=dict(size=14, color=MUTED))
    else:
        x = [to_amsterdam(r["created_at"]) for r in rows]
        y = [r[field] for r in rows]
        fig = go.Figure(go.Scatter(
            x=x, y=y,
            mode="lines",
            line=dict(color=color, width=1.8),
            hovertemplate=f"%{{x|%d %b %H:%M}}<br>{y_label}: %{{y:.1f}} {y_unit}<extra></extra>",
        ))

    fig.update_layout(
        margin=dict(l=0, r=0, t=8, b=0),
        paper_bgcolor=BG,
        plot_bgcolor=BG,
        height=200,
        xaxis=dict(
            showgrid=True, gridcolor=BORDER, zeroline=False,
            tickfont=dict(size=11, color=MUTED),
            tickformat="%d %b\n%H:%M",
        ),
        yaxis=dict(
            showgrid=True, gridcolor=BORDER, zeroline=False,
            tickfont=dict(size=11, color=MUTED),
            title=dict(text=y_unit, font=dict(size=11, color=MUTED)),
        ),
    )
    return fig

def metric_card(title, value, unit, status_text=None, status_color=None):
    return html.Div([
        html.P(title, style={"fontSize": "13px", "color": MUTED, "margin": "0 0 4px"}),
        html.P(value, style={"fontSize": "28px", "fontWeight": "500", "margin": "0", "color": TEXT}),
        html.P(
            f"{unit}{(' — ' + status_text) if status_text else ''}",
            style={"fontSize": "12px", "margin": "4px 0 0",
                   "color": status_color if status_color else MUTED}
        ),
    ], style={
        "background": SURFACE,
        "borderRadius": "8px",
        "padding": "1rem",
        "flex": "1",
        "minWidth": "120px",
    })

app = dash.Dash(
    __name__,
    title="Luchtkwaliteit",
    meta_tags=[{"name": "viewport", "content": "width=device-width, initial-scale=1"}],
)
server = app.server

app.layout = html.Div([
    dcc.Interval(id="interval", interval=60_000, n_intervals=0),

    html.Div([
        html.H1("Luchtkwaliteit", style={
            "fontSize": "20px", "fontWeight": "500",
            "margin": "0", "color": TEXT,
        }),
        dcc.Dropdown(
            id="period",
            options=PERIOD_OPTIONS,
            value=1440,
            clearable=False,
            style={"width": "180px", "fontSize": "13px"},
        ),
    ], style={
        "display": "flex", "alignItems": "center",
        "justifyContent": "space-between",
        "marginBottom": "1.5rem",
    }),

    html.Div(id="metric-cards", style={
        "display": "flex", "gap": "12px",
        "marginBottom": "1.5rem", "flexWrap": "wrap",
    }),

    html.P("CO₂ (ppm)", style={"fontSize": "13px", "color": MUTED, "margin": "0 0 6px"}),
    dcc.Graph(id="chart-co2", config={"displayModeBar": False}),

    html.P("Temperatuur (°C)", style={"fontSize": "13px", "color": MUTED, "margin": "1rem 0 6px"}),
    dcc.Graph(id="chart-temp", config={"displayModeBar": False}),

    html.P("Luchtvochtigheid (%)", style={"fontSize": "13px", "color": MUTED, "margin": "1rem 0 6px"}),
    dcc.Graph(id="chart-rh", config={"displayModeBar": False}),

    html.P(id="footer", style={"fontSize": "12px", "color": MUTED, "marginTop": "1rem"}),

], style={
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "maxWidth": "860px",
    "margin": "0 auto",
    "padding": "2rem 1.5rem",
    "background": BG,
    "minHeight": "100vh",
})


@callback(
    Output("metric-cards", "children"),
    Output("chart-co2",    "figure"),
    Output("chart-temp",   "figure"),
    Output("chart-rh",     "figure"),
    Output("footer",       "children"),
    Input("period",   "value"),
    Input("interval", "n_intervals"),
)
def update(period_minutes, _):
    rows = fetch_data(period_minutes)

    if rows:
        latest = rows[-1]
        co2_val  = latest["co2"]
        temp_val = float(latest["temperature"])
        rh_val   = float(latest["humidity"])
        status, status_color = co2_status(co2_val)

        cards = [
            metric_card("CO₂ (huidig)", str(round(co2_val)), "ppm", status, status_color),
            metric_card("Temperatuur",  f"{temp_val:.1f}", "°C"),
            metric_card("Luchtvochtigheid", f"{rh_val:.1f}", "%"),
            metric_card("Metingen", str(len(rows)), "in geselecteerde periode"),
        ]
        ts = to_amsterdam(latest["created_at"])
        footer = f"Laatste meting: {ts.strftime('%d %b %Y %H:%M')} · vernieuwt automatisch elke minuut"
    else:
        cards = [
            metric_card("CO₂", "—", "ppm"),
            metric_card("Temperatuur", "—", "°C"),
            metric_card("Luchtvochtigheid", "—", "%"),
        ]
        footer = "Geen data in geselecteerde periode"

    return (
        cards,
        make_line_chart(rows, "co2",         C_CO2,  "CO₂",             "ppm"),
        make_line_chart(rows, "temperature", C_TEMP, "Temperatuur",     "°C"),
        make_line_chart(rows, "humidity",    C_RH,   "Luchtvochtigheid", "%"),
        footer,
    )


if __name__ == "__main__":
    app.run(debug=True)