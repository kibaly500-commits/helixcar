-- Les partenaires candidatent ; seul HelixCar attribue une mission.
-- Préserve les missions attribuées et leur avancement existant.
create or replace function private.garder_attribution_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not public.est_admin() and (
    new.convoyeur_id is distinct from old.convoyeur_id
    or (old.statut in ('brouillon','en_attente','proposee') and new.statut is distinct from old.statut)
  ) then
    raise exception 'Postulez à la mission : son attribution est réservée à HelixCar.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.garder_attribution_admin() from public,anon,authenticated;
create trigger garde_attribution_admin before update on public.missions
for each row execute function private.garder_attribution_admin();

create policy missions_attribuees_lecture on public.missions as restrictive for select to authenticated
using(public.est_admin() or convoyeur_id=public.convoyeur_de_session() or public.retenu_preparation_mission(id));
create policy missions_attribuees_modification on public.missions as restrictive for update to authenticated
using(public.est_admin() or convoyeur_id=public.convoyeur_de_session())
with check(public.est_admin() or convoyeur_id=public.convoyeur_de_session());

-- Fermer aussi l'ancien point d'entrée de recette, y compris pour ses comptes de test.
create or replace function public.accepter_opportunite_payee_test(p_opportunite_id uuid) returns jsonb
language sql set search_path = '' as $$
  select jsonb_build_object('ok',false,'code','CANDIDATURE_REQUISE','message','Postulez à cette mission. HelixCar sélectionne les professionnels.');
$$;
revoke all on function public.accepter_opportunite_payee_test(uuid) from public,anon;

-- La sélection admin attribue aussi les anciennes annonces à une place.
create or replace function public.attribuer_preparation_retenue() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.missions%rowtype; o public.opportunites%rowtype;
begin
 select * into o from public.opportunites where id=new.opportunite_id;
 select * into m from public.missions where id=o.mission_id;
 if tg_op='UPDATE' and old.etat='retenu' and new.etat<>'retenu' and m.convoyeur_id=new.convoyeur_id then
  update public.missions set convoyeur_id=null,statut=case when statut='acceptee' then 'en_attente' else statut end where id=m.id;
 end if;
 if new.etat='retenu' and o.nb_professionnels=1 and m.convoyeur_id is null and m.statut in ('en_attente','proposee') then
  update public.missions set convoyeur_id=new.convoyeur_id,statut='acceptee' where id=m.id;
 end if;
 return null;
end $$;
