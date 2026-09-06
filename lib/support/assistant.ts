// Klantenservice-assistent voor bewoners (docs/support-assistant.md).
//
// Eén mail in → één voorgesteld antwoord uit, plus een oordeel of een mens moet meekijken.
// Kennis: de bewonershandleiding, de normen uit de chat-prompt, en (als het adres bekend is)
// de context van precies één sensor. Het model krijgt NOOIT naam/adres van andere bewoners
// en geen ruwe metingen van andere devices: de context wordt hier samengesteld, niet door
// het model opgevraagd. Pure functie rondom één fetch naar OpenRouter.

export interface ResidentContext {
  known: boolean
  firstName: string | null
  deviceNumber: number | null
  room: string | null
  online: boolean | null
  lastSeenMinutesAgo: number | null
  fwVersion: string | null
  profileSummary: string | null      // "appartement, 1945–1974, dubbel glas, raamventilatie, 2 slapers"
  weekSummary: string | null         // uit buildWeeklyDeviceReport: cijfers + tips in tekst
  history?: { at: string; body: string; reply: string | null }[]   // eerdere mails van dit adres, oud → nieuw
}

export interface AssistantReply {
  reply: string
  escalate: boolean
  reason: string
  model: string
}

export const SUPPORT_MANUAL = `
Wat de sensor is: een kleine sensor (Adafruit Feather + Sensirion SCD41) die CO₂, temperatuur en luchtvochtigheid meet in één kamer, elke minuut. Geen microfoon, geen camera. Hangt het liefst in de slaapkamer op ~1,5 m hoogte, niet boven de verwarming, niet naast een raam.
Installatie: (1) QR op de sticker scannen → webpagina met sensornummer (of woongezond.com/admin/start en de code intypen). (2) Stekker erin; na ~30 s knippert het rode lampje 2× = wacht op wifi. (3) Op de telefoon wifi-netwerk "Woongezond-0N" kiezen (N = sensornummer), er opent een pagina, daar eigen wifi + wachtwoord kiezen; sensor herstart. (4) Tien korte vragen over het huis beantwoorden, voorwaarden aanvinken, Opslaan.
Lampje: elke minuut 1 korte flits = alles werkt. 2× knipperen = geen wifi, stap 3 opnieuw. 3× knipperen = neem contact op (de server weigert de sensor).
Wifi: werkt alleen op 2,4 GHz. Netwerk niet in de lijst → kijk of de router ook 2,4 GHz uitzendt (vaak "…-2.4G").
Stroom eraf geweest: niets doen, de sensor onthoudt alles en verbindt vanzelf opnieuw; metingen tijdens de storing ontbreken wel.
Nieuw wifi-wachtwoord of nieuwe router: QR scannen en "WiFi wijzigen" kiezen, of het knopje op de sensor 10 s ingedrukt houden en stap 3 opnieuw doen. Metingen blijven één reeks.
Helemaal opnieuw: QR scannen, "Sensor resetten", stekker even eruit en erin.
Sensor naar een andere bewoner: nieuwe bewoner scant de QR en kiest "Overdragen aan een nieuwe bewoner"; contactgegevens van de vorige bewoner worden losgekoppeld.
Verkeerde kamer ingevuld: QR opnieuw scannen, "opnieuw registreren".
Eigen metingen zien: optioneel een account maken via de link aan het einde van de registratie.
Weekrapport: elke maandagochtend per e-mail, alleen als de bewoner daar bij de registratie om vroeg. Afmelden kan door dat te vragen.
Privacy: de corporatie ziet alleen cijfers per sensornummer, nooit naam of adres. Metingen zijn geen bewijs van bewonersgedrag.
Normen: CO₂ < 800 ppm goed, 800–1000 matig, > 1000 slecht (Bouwbesluit-grens). Luchtvochtigheid 40–60% ideaal, 60–70% aandacht, > 70% schimmelgevaar. Ventilatie-norm 0,9 luchtwisselingen per uur.
Menselijk contact: woongezond@vostech.group.
`.trim()

export function buildSystemPrompt(ctx: ResidentContext, today: string): string {
  const who = ctx.known
    ? `De afzender is bekend: ${ctx.firstName ? `voornaam ${ctx.firstName}, ` : ''}sensor ${ctx.deviceNumber != null ? String(ctx.deviceNumber).padStart(2, '0') : '?'}${ctx.room ? ` in de ${ctx.room}` : ''}. ` +
      `Sensorstatus: ${ctx.online == null ? 'onbekend' : ctx.online ? 'online' : 'OFFLINE'}${ctx.lastSeenMinutesAgo != null ? ` (laatste meting ${ctx.lastSeenMinutesAgo < 90 ? `${ctx.lastSeenMinutesAgo} min` : `${Math.round(ctx.lastSeenMinutesAgo / 60)} uur`} geleden)` : ''}${ctx.fwVersion ? `, firmware ${ctx.fwVersion}` : ''}.` +
      (ctx.profileSummary ? `\nWoning volgens de bewoner: ${ctx.profileSummary}.` : '') +
      (ctx.weekSummary ? `\n\nAfgelopen 7 dagen van deze sensor:\n${ctx.weekSummary}` : '\n\nEr zijn geen metingen van de afgelopen 7 dagen.')
    : `De afzender is NIET gekoppeld aan een sensor (e-mailadres onbekend). Geef alleen algemene hulp; vraag om het sensornummer van de sticker als dat nodig is, en deel nooit metingen.`

  return [
    `Je bent de klantenservice-assistent van Woongezond, een pilot met luchtkwaliteitssensoren in huurwoningen. Vandaag is ${today}.`,
    `Je beantwoordt e-mails van bewoners. Schrijf in het Nederlands, tutoyeer, warm en kort (max ~180 woorden), geen markdown, geen koppen, geen opsommingstekens met sterretjes. Gebruik gewone alinea's of regels met "1." als stappen echt nodig zijn. Onderteken met "Woongezond".`,
    `Regels: (1) Verzin niets over de sensor of de metingen; als je het niet weet, zeg dat en verwijs naar woongezond@vostech.group. (2) Deel alleen metingen van de sensor van de afzender zelf. (3) Bij gezondheidsklachten, schimmel die zichtbaar is, conflicten met de verhuurder, boosheid, of een verzoek om gegevens te verwijderen: antwoord vriendelijk, beloof niets, en zet escalate op true. (4) Vragen over afmelden voor het weekrapport of het verwijderen van gegevens: bevestig dat het geregeld wordt en escaleer (een mens voert het uit). (5) Geen juridisch advies.`,
    `\n## Handleiding\n${SUPPORT_MANUAL}`,
    `\n## Afzender\n${who}`,
    `\nAntwoord ALLEEN met JSON: {"reply": "<de e-mailtekst>", "escalate": true|false, "reason": "<één zin waarom wel/niet een mens moet meekijken>"}`,
  ].join('\n')
}

export async function composeSupportReply(
  inbound: { from: string; subject: string; body: string },
  ctx: ResidentContext,
  opts: { key?: string; model?: string; now?: Date } = {},
): Promise<AssistantReply> {
  const key = opts.key ?? process.env.OPENROUTER_API_KEY
  const model = opts.model ?? process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash'
  if (!key) throw new Error('OPENROUTER_API_KEY ontbreekt')
  const now = opts.now ?? new Date()
  const today = now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' })

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://woongezond.com', 'X-Title': 'Woongezond support', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(ctx, today) },
        ...historyMessages(ctx.history),
        { role: 'user', content: `Onderwerp: ${inbound.subject || '(geen onderwerp)'}\n\n${inbound.body || '(lege mail)'}` },
      ],
    }),
  })
  if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  const content: string = j?.choices?.[0]?.message?.content ?? ''
  const parsed = parseReply(content)
  if (!parsed) throw new Error(`model gaf geen bruikbare JSON: ${content.slice(0, 200)}`)
  return { ...parsed, model }
}

/** Eerdere mails als echte gespreksbeurten, zodat "zoals ik vorige week schreef" werkt. Max 6. */
export function historyMessages(history: ResidentContext['history']): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const h of (history ?? []).slice(-6)) {
    const when = new Date(h.at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' })
    out.push({ role: 'user', content: `[eerdere mail, ${when}]\n${h.body.slice(0, 1500)}` })
    if (h.reply) out.push({ role: 'assistant', content: JSON.stringify({ reply: h.reply.slice(0, 1500), escalate: false, reason: 'eerder antwoord' }) })
  }
  return out
}

export function parseReply(content: string): Omit<AssistantReply, 'model'> | null {
  const m = content.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    if (typeof o.reply !== 'string' || !o.reply.trim()) return null
    return { reply: o.reply.trim(), escalate: Boolean(o.escalate), reason: typeof o.reason === 'string' ? o.reason : '' }
  } catch {
    return null
  }
}
