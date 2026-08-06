-- Fix 2: scalable historical outdoor weather, stored per CITY (not per device).
-- Devices link to a city via devices.city_id. The hourly ingest cron fetches
-- OpenWeather once per distinct city, so cost is O(cities), not O(devices).

-- ── cities ──────────────────────────────────────────────────────────────────
create table if not exists public.cities (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  lat        double precision not null,
  lon        double precision not null,
  created_at timestamptz default now(),
  unique (lat, lon)
);

-- ── city_weather (historical hourly series read by the schimmel page) ────────
create table if not exists public.city_weather (
  id          bigint generated always as identity primary key,
  city_id     uuid not null references public.cities(id) on delete cascade,
  observed_at timestamptz not null,        -- truncated to the hour
  temp        double precision,            -- °C
  humidity    double precision,            -- %
  pressure    double precision,            -- hPa
  wind_speed  double precision,            -- m/s
  description text,
  created_at  timestamptz default now(),
  unique (city_id, observed_at)
);
create index if not exists city_weather_city_observed_idx
  on public.city_weather (city_id, observed_at desc);

-- ── devices.city_id FK ───────────────────────────────────────────────────────
alter table public.devices
  add column if not exists city_id uuid references public.cities(id);

-- ── RLS: weather is shared reference data, not per-user ──────────────────────
alter table public.cities       enable row level security;
alter table public.city_weather enable row level security;

drop policy if exists cities_select_auth on public.cities;
create policy cities_select_auth on public.cities
  for select to authenticated using (true);

drop policy if exists city_weather_select_auth on public.city_weather;
create policy city_weather_select_auth on public.city_weather
  for select to authenticated using (true);
-- Writes happen only through the service-role ingest route, which bypasses RLS.

-- ── Backfill cities from existing device coordinates (rounded to ~1 km) ──────
insert into public.cities (name, lat, lon)
select coalesce(min(d.city), 'Onbekend'),
       round(d.lat::numeric, 2)::double precision,
       round(d.lon::numeric, 2)::double precision
from public.devices d
where d.lat is not null and d.lon is not null
group by round(d.lat::numeric, 2), round(d.lon::numeric, 2)
on conflict (lat, lon) do nothing;

-- Default city (current hardcoded weather coord) for devices without coords.
insert into public.cities (name, lat, lon)
values ('Amsterdam', 52.37, 4.89)
on conflict (lat, lon) do nothing;

-- Link devices with coords to their matching city.
update public.devices d
set city_id = c.id
from public.cities c
where d.lat is not null and d.lon is not null
  and round(d.lat::numeric, 2)::double precision = c.lat
  and round(d.lon::numeric, 2)::double precision = c.lon;

-- Link devices without coords to the default Amsterdam city.
update public.devices d
set city_id = c.id
from public.cities c
where d.city_id is null and c.lat = 52.37 and c.lon = 4.89;
