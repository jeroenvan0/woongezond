// Shared chat constants + formatters for the AI assistant (ported from chat.py).
import { dewpoint } from './calculations'
import { wallDelta, mouldRiskWd } from './trends'

export const CHAT_SYSTEM_PROMPT = (now: string, today: string) =>
  `Je bent een deskundige AI-assistent ingebouwd in een luchtkwaliteitsmonitor voor een woning. ` +
  `Je helpt de bewoner de sensordata te begrijpen en geeft praktisch advies.\n\n` +
  `De huidige datum/tijd is ${now}. Vandaag is ${today}.\n\n` +
  `## Meetdata\n` +
  `De sensors registreren CO₂ (ppm), temperatuur (°C) en luchtvochtigheid (%) elke minuut. ` +
  `Berekende waarden: dauwpunt (Magnus-formule), schimmelrisico (0–100), ventilatie ACH.\n\n` +
  `## Normen\n` +
  `- CO₂: < 800 ppm = goed | 800–1000 = matig | > 1000 ppm = slecht (Bouwbesluit max 1000)\n` +
  `- Luchtvochtigheid: 40–60% = ideaal | 60–70% = aandacht | > 70% = schimmelgevaar\n` +
  `- Schimmelrisico: 0–60 = OK | 60–80 = risico | > 80 = kritiek\n\n` +
  `## Tool gebruik — PROACTIEF\n` +
  `Je hebt vier tools:\n` +
  `1. \`query_sensor_data(start, end)\` — ruwe statistieken voor een specifieke periode (ISO-8601 met tijdzone)\n` +
  `2. \`query_current_weather()\` — actueel buitenweer + luchtkwaliteit (AQI, PM2.5, NO₂)\n` +
  `3. \`analyze_nights()\` — vergelijkt de nachten onderling: per nacht de CO₂-piek en -stijging, plus hoe de laatste nacht zich verhoudt tot het gemiddelde. Gebruik dit ALTIJD voor vragen als "hoe was vannacht", "hoe sliep ik", "hoe was de nacht t.o.v. andere nachten".\n` +
  `4. \`get_diagnosis(days)\` — samenvattende diagnose: ventilatie (ACH), nacht/dag-CO₂, schimmel-percentage, vochtprofiel (lekkage/bouwkundig/gedrag) en concrete bevindingen. Gebruik dit voor "wat is er aan de hand", "is er een probleem", "moet ik iets doen".\n` +
  `5. \`intervention_effects()\` — het gemeten effect van geregistreerde interventies (2 weken vóór vs. ná): CO₂, RV en gezondheidsscore. Gebruik dit voor "hielp het openzetten van het rooster", "werkte de ingreep", "wat was het effect van ...".\n\n` +
  `Roep ZELF de juiste tool aan zodra een vraag iets nodig heeft dat niet al in de huidige dashboarddata staat — vraag NIET om bevestiging, geef meteen antwoord met de opgehaalde cijfers. ` +
  `Gebruik voor query_sensor_data ISO-8601 met tijdzone (+01:00 winter / +02:00 zomer Europa/Amsterdam).\n\n` +
  `## Gedrag\n` +
  `- Antwoord altijd in het Nederlands tenzij anders gevraagd\n` +
  `- Verwijs concreet naar sensordata (met getallen)\n` +
  `- Geef altijd een concreet actie-advies bij problematische waarden\n` +
  `- Houd antwoorden bondig (max ~200 woorden)\n` +
  `- Geen markdown-koppen, wel **vet** voor kernpunten en lijsten met '- '`

export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_sensor_data',
      description:
        'Haal luchtkwaliteitsdata op voor een specifieke tijdsperiode. Gebruik dit wanneer de gebruiker vraagt over een periode die niet in de huidige dashboarddata zit.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: "Startdatumtijd ISO 8601 met tijdzone (bijv. '2026-05-17T00:00:00+02:00')" },
          end: { type: 'string', description: 'Einddatumtijd ISO 8601 met tijdzone' },
        },
        required: ['start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_current_weather',
      description:
        'Haal de actuele buitenweerdata op: temperatuur, luchtvochtigheid, dauwpunt, wind, luchtdruk, neerslag en luchtkwaliteit (AQI, PM2.5). Gebruik dit voor vragen over buitenweer of binnen/buiten-vergelijkingen.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_nights',
      description:
        'Analyseer de afgelopen ~2 weken nacht-voor-nacht: per nacht de CO₂-piek (23–07u) en de stijging t.o.v. de avond, plus de mediaan over alle nachten en hoe de laatste nacht zich daartoe verhoudt. Gebruik dit voor elke vraag over slapen, vannacht, of nachten onderling vergelijken.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnosis',
      description:
        'Geef een samenvattende diagnose over de woning: ventilatie (ACH t.o.v. norm 0,9), nacht/dag-CO₂, percentage tijd met schimmelrisico > 60, vochtprofiel (lekkage / bouwkundig / gedrag) en concrete bevindingen + conclusie. Gebruik dit voor "is er een probleem", "wat is er aan de hand", "moet ik iets doen".',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Aantal dagen historie om te analyseren (standaard 14)' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'intervention_effects',
      description:
        'Bekijk het gemeten effect van geregistreerde interventies (wijzigingen in de woning, bv. "rooster opengezet"). Geeft per interventie het gemiddelde van CO₂, RV en gezondheidsscore in de 2 weken ervoor versus erna. Gebruik dit voor vragen of een ingreep heeft geholpen.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

interface Row {
  created_at: string
  co2: number | null
  temperature: number | null
  humidity: number | null
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

function arrays(rows: Row[]) {
  const r = rows.filter((x) => x.co2 != null && x.temperature != null && x.humidity != null)
  return {
    times: r.map((x) => new Date(x.created_at)),
    co2: r.map((x) => +x.co2!),
    temp: r.map((x) => +x.temperature!),
    rh: r.map((x) => +x.humidity!),
  }
}

/** Summary of the latest readings for the system prompt. */
export function buildDataSummary(rows: Row[]): string {
  const { times, co2, temp, rh } = arrays(rows)
  if (!co2.length) return 'Er is momenteel geen sensordata geladen in het dashboard.'
  const last = co2.length - 1
  const h = times[last].getHours() + times[last].getMinutes() / 60
  const dp = dewpoint(temp[last], rh[last])
  const mrLast = mouldRiskWd(temp[last], rh[last], wallDelta(h))
  const periodH = (times[last].getTime() - times[0].getTime()) / 3_600_000
  const pctCo2 = (co2.filter((v) => v > 1000).length / co2.length) * 100
  return [
    `Periode: laatste ${periodH.toFixed(1)} uur (${co2.length} metingen)`,
    `Laatste meting: ${times[last].toLocaleString('nl-NL')}`,
    '',
    'Actuele waarden (laatste meting):',
    `  CO₂:              ${Math.round(co2[last])} ppm`,
    `  Temperatuur:      ${temp[last].toFixed(1)} °C`,
    `  Luchtvochtigheid: ${rh[last].toFixed(1)} %`,
    `  Dauwpunt:         ${dp.toFixed(1)} °C`,
    `  Schimmelrisico:   ${mrLast.toFixed(1)} / 100`,
    '',
    'Gemiddelden over de periode:',
    `  CO₂:  gem ${Math.round(mean(co2))} | max ${Math.round(Math.max(...co2))} ppm`,
    `  Temp: gem ${mean(temp).toFixed(1)} °C`,
    `  RV:   gem ${mean(rh).toFixed(1)} | max ${Math.max(...rh).toFixed(1)} %`,
    '',
    `CO₂ > 1000 ppm: ${pctCo2.toFixed(1)}% van de tijd`,
  ].join('\n')
}

/** Format a sensor-query tool result. */
export function formatSensorQuery(rows: Row[], start: string, end: string): string {
  const { times, co2, temp, rh } = arrays(rows)
  if (!co2.length) return `Geen sensordata gevonden voor de periode ${start} – ${end}.`
  const periodH = (times[times.length - 1].getTime() - times[0].getTime()) / 3_600_000
  const mr = times.map((t, i) => mouldRiskWd(temp[i], rh[i], wallDelta(t.getHours() + t.getMinutes() / 60)))
  const fmt = (d: Date) => d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return [
    `Queryresultaat ${fmt(times[0])} – ${fmt(times[times.length - 1])} (${co2.length} metingen, ${periodH.toFixed(1)}u):`,
    `CO₂:      gem ${Math.round(mean(co2))} | min ${Math.round(Math.min(...co2))} | max ${Math.round(Math.max(...co2))} ppm`,
    `Temp:     gem ${mean(temp).toFixed(1)} | min ${Math.min(...temp).toFixed(1)} | max ${Math.max(...temp).toFixed(1)} °C`,
    `RV:       gem ${mean(rh).toFixed(1)} | min ${Math.min(...rh).toFixed(1)} | max ${Math.max(...rh).toFixed(1)} %`,
    `Schimmel: gem ${mean(mr).toFixed(1)} | max ${Math.max(...mr).toFixed(1)} /100`,
    `CO₂ > 1000 ppm: ${((co2.filter((v) => v > 1000).length / co2.length) * 100).toFixed(1)}% van de tijd`,
  ].join('\n')
}
