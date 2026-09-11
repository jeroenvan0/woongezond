-- org_members: alleen je eigen lidmaatschapsrijen zichtbaar.
--
-- De policy was is_org_member(org_id): "leden van dezelfde organisatie". Daarmee zag een
-- medewerker zonder adminrol óók de adminrij van een collega, en vier API-routes plus de
-- navigatie leidden hun rol af uit "is er een rij met role = admin" zonder op user_id te
-- filteren. Een viewer werd daarmee behandeld als admin: cockpit, klantenservice-inbox en
-- /beheer gingen open, inclusief namen en mailadressen van bewoners. Vandaag niet
-- misbruikbaar (de organisatie heeft één lid), maar /uitnodigingen bestaat om dat te
-- veranderen.
--
-- De app filtert sinds commit ca0e592 zelf op user_id; dit is de tweede lijn, zodat de
-- fout niet terug kan komen als iemand later een query zonder filter schrijft.
--
-- Veilig: geen enkel scherm toont een ledenlijst (gecontroleerd), en de helpers
-- is_org_member() en device_in_my_org() zijn SECURITY DEFINER, dus die lezen org_members
-- buiten RLS om en blijven werken.
--
-- Terugdraaien: vervang de USING-expressie hieronder door public.is_org_member(org_id).

drop policy if exists "org_members_select_same_org" on public.org_members;

create policy "org_members_select_own" on public.org_members as permissive for select to authenticated
  using (user_id = (select auth.uid()));
