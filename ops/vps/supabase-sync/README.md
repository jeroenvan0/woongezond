# Backup Supabase Cloud → VPS

De nachtelijke kopie van de cloud-database naar de self-hosted Supabase op de VPS.
Draait via `supabase-sync.timer` om 03:00 (01:00 UTC), unit `supabase-sync.service`,
script `/opt/supabase-sync/sync.py`.

Dit script stond alleen op de server en nergens in versiebeheer. Sinds 8 september 2026
staat het hier, zodat een wijziging terug te vinden en terug te draaien is.

## Plaatsen op de VPS

```bash
scp ops/vps/supabase-sync/sync.py         root@153.92.223.130:/opt/supabase-sync/sync.py
scp ops/vps/supabase-sync/last_sync.json  root@153.92.223.130:/opt/supabase-sync/last_sync.json
ssh root@153.92.223.130 'chmod 700 /opt/supabase-sync/sync.py'
```

Draaien en meekijken:

```bash
ssh root@153.92.223.130 'systemctl start supabase-sync.service; journalctl -u supabase-sync.service -f'
```

Het origineel van vóór 8 september staat op de server als `/opt/supabase-sync/sync.py.bak-20260908`.
`.env` (met de service-role-key) blijft bewust alleen op de server staan.

## Wat er op 8 september 2026 is gerepareerd

De backup faalde drie nachten achter elkaar zonder dat iemand het merkte
(`HEALTHCHECKS_URL` in de `.env` is leeg, dus de fail-ping wordt overgeslagen).

1. **Tabelvolgorde.** `air_quality` stond bovenaan, vóór `devices`. De metingen van een
   nieuwe sensor kwamen dus aan vóór de sensor zelf → foreign key violation → de hele
   tabel faalde. Ouders staan nu vóór hun kinderen.
2. **Ontbrekende tabellen.** De synclijst kende 12 tabellen, de cloud had er 26. Alles wat
   na mei 2026 is gebouwd — organisaties, koppelcodes, contacten, support, rapportverzendingen,
   weerhistorie — werd niet geback-upt. Nu wel; de lokale tabellen zijn aangemaakt zonder
   foreign keys, want dit is een backup en geen draaiende replica.
3. **Kolommen.** Het script haalde `select=*` op en propte alles in de lokale tabel, dus
   élke migratie in de cloud die een kolom toevoegde brak die tabel stilletjes (zo ging
   `devices` onderuit op `city_id`). Nu wordt de doorsnede gesynchroniseerd en gelogd wat
   er is overgeslagen.
4. **Zichtbaarheid.** Elke run schrijft zijn resultaat nu óók naar `public.sync_runs` in de
   cloud (migratie `20260908150000`), zodat `/beheer` in de app laat zien of de backup nog
   loopt. De lokale `sync_runs` op de VPS blijft bestaan.

`last_sync.json` heeft voor de nieuwe tabellen een watermerk in het jaar 2000, zodat de
eerste run alle historie ophaalt. Daarna schuiven de watermerken vanzelf mee.

## Bekende beperking

De watermerken staan op `created_at` voor tabellen die later nog van status veranderen
(`device_claim_codes.used_at`, `support_messages.status`). Die rijen komen één keer mee en
worden daarna niet meer bijgewerkt. Voor een backup is dat acceptabel; wil je ze wel
actueel, dan moet er een `updated_at` op die tabellen komen.
