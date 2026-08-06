# B3 + A3 — per-device (kamer) scoping & eerlijke ruwe telling

**Ontwerp, 2026-08-06.** Onderdeel van [ux-and-features-plan.md](./ux-and-features-plan.md).
Migratie: [`20260806120100_air_quality_bucketed_device_param.sql`](../supabase/migrations/20260806120100_air_quality_bucketed_device_param.sql).

## Waarom
- **B3:** vandaag mengt `air_quality_bucketed(minutes)` alle devices van een account door
  elkaar (`user_id = auth.uid()`, geen device-filter). Vocht/schimmel is kamer-specifiek;
  de bewoner moet slaapkamer vs badkamer kunnen scheiden. Device-*identiteit* shipte al in
  `ui-improvements` (`DeviceSwitcher`, `useSelectedDevice`); alleen de grafiek-scoping ontbrak.
- **A3:** `/api/data` rapporteert `rawCount = rows.length` op de RPC-pad — dat is het aantal
  *buckets*, niet ruwe metingen (tot 360× te laag). Een UI-zichtbare onwaarheid (KI-1's staart).

## Migratie (server)
- `air_quality_bucketed(minutes, p_device_id uuid default null)` — optionele device-filter.
  De defaulted param houdt bestaande aanroepen werkend.
- `air_quality_raw_count(minutes, p_device_id uuid default null)` — één `count(*)`, geeft de
  echte ruwe telling. Draait als aanroeper (RLS blijft de grens).

## Client/API-wiring — defensief, werkt vóór én na toepassen
`app/api/data/route.ts` accepteert nu `?device=<uuid>` en:
1. roept `air_quality_bucketed({ minutes, p_device_id })` aan; valt bij een param-fout terug
   op `air_quality_bucketed({ minutes })` (oude signatuur) → **breekt niet als de migratie
   nog niet is toegepast.**
2. probeert `air_quality_raw_count` voor een echte `rawCount`; faalt dat, dan de oude
   `rows.length` als benadering.

`lib/useSeries.ts` en de dashboard-callers geven de geselecteerde `device` mee (uit
`useSelectedDevice`). Zonder selectie → geen device-param → huidig gedrag (alle devices).

## Toepassen
Zie [corporatie-fleet-design.md](./corporatie-fleet-design.md) §9 — zelfde migratiebatch.
Tot toepassing draait alles op de fallback-paden; geen regressie.
