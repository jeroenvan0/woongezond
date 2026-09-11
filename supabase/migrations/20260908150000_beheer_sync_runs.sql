-- Systeemstatus voor het adminportaal (/beheer, fase 1).
--
-- De nachtelijke backup naar de VPS logt zijn runs in een sync_runs-tabel op die VPS zelf.
-- De app praat met de cloud en kan daar niet bij, en precies daardoor bleef het falen van
-- 6, 7 en 8 september drie nachten onzichtbaar. Dit is dezelfde logregel, maar in de cloud:
-- het syncscript schrijft hem met de service-role (RLS wordt dan overgeslagen), org-admins
-- lezen hem in /beheer.

create table if not exists public.sync_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  status        text not null check (status in ('running', 'success', 'error')),
  rows_synced   integer not null default 0,
  tables_ok     text[] not null default '{}',
  tables_failed text[] not null default '{}',
  duration_s    numeric,
  error_detail  text,
  source        text not null default 'vps-backup',
  created_at    timestamptz not null default now()
);

create index if not exists idx_sync_runs_started on public.sync_runs using btree (started_at desc);

-- Ben ik ergens org-admin? SECURITY DEFINER zodat de policy-subquery niet zelf door de
-- RLS van org_members hoeft (dezelfde reden als is_org_member / device_in_my_org).
create or replace function public.is_any_org_admin()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.org_members m
    where m.user_id = auth.uid() and m.role = 'admin'
  );
$function$;
revoke execute on function public.is_any_org_admin() from public, anon;
grant execute on function public.is_any_org_admin() to authenticated;

alter table public.sync_runs enable row level security;

drop policy if exists "sync_runs_read_admin" on public.sync_runs;
create policy "sync_runs_read_admin" on public.sync_runs as permissive for select to authenticated
  using (public.is_any_org_admin());
