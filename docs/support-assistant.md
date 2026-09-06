# Klantenservice-assistent per e-mail

Status **2026-09-06**, branch `feat/pilot-cockpit`. Bewoners mailen naar één adres; een
assistent (OpenRouter, zelfde sleutel en model als de dashboard-chat) schrijft een antwoord
met de handleiding en de context van precies hun eigen sensor. Een mens kijkt mee.

```
bewoner ──mail──▶ hulp@woongezond.com
                    │  MX-record (Strato) wijst naar Resend
                    ▼
               Resend Receiving ──webhook email.received──▶ POST /api/inbox
                                                               │ handtekening checken (Svix)
                                                               │ body ophalen via Resend API
                                                               │ afzender → device_contacts → sensor + weekcijfers
                                                               │ OpenRouter → {reply, escalate, reason}
                                                               │ support_messages (log)
                                                               ▼
                          draft: voorstel naar SUPPORT_ADMIN_ADDR      auto: antwoord naar bewoner
                                 (bewoner krijgt niets)                       in dezelfde thread, admin in bcc
                                                                              escalatie → alleen admin
```

## Bestanden

| | |
|---|---|
| `app/api/inbox/route.ts` | De webhook. Idempotent op `resend_email_id`; antwoordt 200 zodra de mail is opgeslagen |
| `app/cockpit/inbox/page.tsx` + `app/api/cockpit/inbox/route.ts` | De inbox voor beheerders: filter per sensor / bewoner / org, open vs. afgehandeld, zoeken; gesprekken per adres; verstuurde rapporten in dezelfde tijdlijn; acties verstuur / afhandelen / heropenen |
| `lib/cockpit/auth.ts` | Gedeelde admin-check (org_members.role = admin) |
| `lib/support/resendInbound.ts` | Svix-handtekening, mail ophalen, quotes/HTML strippen |
| `lib/support/context.ts` | E-mailadres → sensor, status, huisprofiel, weekcijfers (hergebruikt het weekrapport) |
| `lib/support/assistant.ts` | Systeemprompt met handleiding + regels, OpenRouter-call, JSON-antwoord |
| `scripts/support-sim.mts` | `npm run support:sim -- --from adres --subject … --body …` — test zonder Resend |
| `supabase/migrations/20260906120000_support_messages.sql` | Log-tabel, alleen service-role |

## Omgevingsvariabelen

```
SUPPORT_MODE=draft                # draft | auto | off
SUPPORT_ADMIN_ADDR=jij@…          # ontvangt voorstellen, escalaties en fouten
SUPPORT_FROM_ADDR="Woongezond <hulp@woongezond.com>"
SUPPORT_REPLY_TO=help@woongezond.com   # ontvangstadres op het Resend-subdomein; ook Reply-To van het weekrapport
RESEND_WEBHOOK_SECRET=whsec_…     # signing secret van de webhook in Resend
```
Plus de bestaande `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.

## Privacy-regels die in de code zitten

- De assistent krijgt alleen context van de sensor die bij het **afzenderadres** hoort
  (`device_contacts.email`, hoofdletterongevoelig). Onbekend adres → alleen algemene hulp,
  en de prompt bevat dan geen metingen.
- Het model heeft geen tools: het kan niets opvragen, alleen lezen wat wij meegeven.
- `support_messages` heeft RLS zonder policies: geen viewer, geen admin-UI, alleen de server.
- Escalatie is verplicht bij: gezondheidsklachten, zichtbare schimmel, conflict met de
  verhuurder, boosheid, verwijderverzoek, afmelden. Dan gaat er in `auto`-stand niets naar
  de bewoner, alleen naar jou.

## Ontvangstadres: help@woongezond.com

Sinds 2026-09-06 wijst het MX-record van woongezond.com naar Resend
(`inbound-smtp.eu-west-1.amazonaws.com`, prio 10). De Strato-domeinbundel had geen mailpakket,
dus er ging niets verloren. Elke naam vóór de @ komt nu bij de assistent; **help@woongezond.com**
is het adres voor bewoners. Het resend.app-testadres (hulp@hlodepe.resend.app) werkt ook nog. Getest op 2026-09-06: mail vanuit Gmail →
Resend → `npm run support:sim -- --inbox --send` → antwoord in dezelfde thread. Voor de pilot
is dit genoeg; `SUPPORT_REPLY_TO=help@woongezond.com` staat daarom nu in `.env.local`,
zodat antwoorden op het weekrapport hier binnenkomen. Het eigen subdomein hieronder is de
nettere versie voor later.

## DNS: MX-record bij Strato (later, optioneel)

Stand 2026-09-06: `hulp.woongezond.com` bestaat als subdomein bij Strato en staat in Resend
(id `f1f09978…`, regio eu-west-1, receiving aan). De webhook naar
`https://woongezond.com/admin/api/inbox` bestaat (id `3446cbd9…`); de signing secret staat
lokaal in `.env.local` en moet nog op de VPS.

Waarom een subdomein: `woongezond.com` heeft al een MX-record naar Strato (`smtp.rzone.de`).
Het laagste prioriteitsgetal wint, dus een Resend-record ernaast breekt de bestaande mail.
Bewoners mailen daarom naar **help@woongezond.com**. De app verstuurt vanaf
`hulp@woongezond.com` (al geverifieerd) met `Reply-To: help@woongezond.com`, zodat elk
antwoord van een bewoner bij de assistent binnenkomt (`SUPPORT_REPLY_TO`, ook op het weekrapport).

**Eén record is genoeg** (de SPF/DKIM-records die Resend voor het subdomein toont zijn alleen
nodig als je óók vanaf `@hulp.woongezond.com` wilt versturen; dat doen we niet):

| Bij Strato onder | Type | Hostnaam / mailserver | Prioriteit |
|---|---|---|---|
| subdomein `hulp.woongezond.com` → DNS → MX-record | MX | `inbound-smtp.eu-west-1.amazonaws.com` | 4 (Strato-dropdown: "Hoog") |

Stappen in Strato: Domeinen → woongezond.com → subdomein `hulp` → DNS-instellingen →
MX-record → Primaire mailserver "Eigen mailserver" → eerste Hostnaam de waarde hierboven,
tweede veld leeg, Back-up mailserver "Deactiveren" → Instellingen doorvoeren. Let op dat de
kop van de pagina `hulp.woongezond.com` zegt en niet `woongezond.com` of `vostech.group`.

Controle na 5 min tot enkele uren: `dig +short MX hulp.woongezond.com` moet
`4 inbound-smtp.eu-west-1.amazonaws.com.` geven; Resend zet het domein dan op *Verified*.

Daarna op de VPS in `.env.local`: `RESEND_WEBHOOK_SECRET`, `SUPPORT_MODE=draft`,
`SUPPORT_ADMIN_ADDR`, `SUPPORT_FROM_ADDR`, `SUPPORT_REPLY_TO` (waarden: zie lokaal
`.env.local`), deze branch uitrollen, `systemctl restart woongezond-react`. Test: mail vanaf
je Gmail naar help@woongezond.com; in `draft` komt het voorstel op `SUPPORT_ADMIN_ADDR`.
Logs: `journalctl -u woongezond-react -o cat | jq 'select(.scope=="support")'`.

## Stappen naar productie — stand 2026-09-06

1. [x] Ontvangst via help@woongezond.com + webhook aangemaakt (subdomein-MX is optioneel, later).
   [ ] Branch uitrollen + env op de VPS; een week in `draft` meedraaien.
2. [x] Cockpit `/cockpit` sectie "Inbox klantenservice": voorstel bewerken, *Verstuur dit
   antwoord* (in dezelfde thread), *Afgehandeld zonder antwoord*. Handmatig verstuurde
   antwoorden krijgen status `answered`, gesloten `closed`.
3. [ ] `SUPPORT_MODE=auto` aanzetten voor niet-geëscaleerde mails (één env-regel).
4. [x] Gespreksgeheugen: de laatste 6 mails van hetzelfde adres (met het antwoord dat ging)
   gaan als eerdere beurten mee naar het model (`residentContext` → `history`). Getest: een
   vervolgvraag "is dat nu geregeld?" verwijst naar de eerdere afmelding.
