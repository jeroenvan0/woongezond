-- Per-house wall insulation class, driving R_totaal in the wall-conditions calc.
-- Default 'poor' is the conservative (coldest-wall) assumption.
alter table public.devices
  add column if not exists insulation text not null default 'poor'
  check (insulation in ('poor', 'moderate', 'good', 'excellent'));

comment on column public.devices.insulation is
  'Wall insulation class → R_totaal (m²K/W): poor 0.35, moderate 0.90, good 2.50, excellent 4.00';

-- Known houses (per user instruction).
update public.devices set insulation = 'poor'     where name = 'Jeroen Sensor';
update public.devices set insulation = 'moderate' where name = 'Jannouk Sensor';

-- Primary device for the calling user: the active device with the most recent
-- reading (each user's readings come from one sensor). Used by the schimmel page
-- to pick the right city + insulation. SECURITY INVOKER so RLS still applies.
create or replace function public.schimmel_device_context()
returns table(device_id uuid, device_name text, insulation text, city_id uuid)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select d.id, d.name, coalesce(d.insulation, 'poor'), d.city_id
  from public.devices d
  where d.user_id = auth.uid() and d.active = true
  order by (
    select max(aq.created_at) from public.air_quality aq where aq.device_id = d.id
  ) desc nulls last, d.created_at desc
  limit 1;
$$;
