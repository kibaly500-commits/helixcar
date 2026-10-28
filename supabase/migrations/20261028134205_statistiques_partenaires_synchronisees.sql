-- Statistiques dérivées des missions réalisées et des évaluations clients.
create schema if not exists private;
alter table public.convoyeurs alter column note drop default;

create or replace function private.hc_calculer_stats_partenaire()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select count(*)::integer,
    coalesce(sum(case when m.type_mission = 'convoyage' then greatest(coalesce(m.distance_km,0),0) else 0 end),0)::integer
  into new.nb_missions, new.km_total
  from public.missions m where m.convoyeur_id = new.id and m.statut = 'terminee';
  select round(avg(e.note_totale),2) into new.note
  from public.evaluations e join public.missions m on m.id = e.mission_id
  where m.convoyeur_id = new.id and e.convoyeur_id = new.id and m.statut = 'terminee';
  return new;
end;
$$;
revoke all on function private.hc_calculer_stats_partenaire() from public, anon, authenticated;
create trigger hc_calculer_stats_partenaire
before insert or update of note, nb_missions, km_total on public.convoyeurs
for each row execute function private.hc_calculer_stats_partenaire();

create or replace function private.hc_actualiser_stats_partenaire()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ancien uuid; nouveau uuid; partenaire uuid;
begin
  if tg_op <> 'INSERT' then ancien := old.convoyeur_id; end if;
  if tg_op <> 'DELETE' then nouveau := new.convoyeur_id; end if;
  -- Ordre stable et verrou avant recalcul : plusieurs missions concurrentes
  -- ne doivent ni perdre une réalisation ni compter deux fois la même mission.
  for partenaire in select distinct x from unnest(array[ancien,nouveau]) as t(x) where x is not null order by x loop
    perform 1 from public.convoyeurs where id = partenaire for update;
    update public.convoyeurs set nb_missions = nb_missions where id = partenaire;
  end loop;
  return null;
end;
$$;
revoke all on function private.hc_actualiser_stats_partenaire() from public, anon, authenticated;
create trigger hc_stats_apres_mission
 after insert or delete or update of convoyeur_id, statut, type_mission, distance_km on public.missions
 for each row execute function private.hc_actualiser_stats_partenaire();
create trigger hc_stats_apres_evaluation
 after insert or delete or update of convoyeur_id, mission_id, note_totale on public.evaluations
 for each row execute function private.hc_actualiser_stats_partenaire();

-- Répare également les profils existants sans modifier leurs missions/avis.
update public.convoyeurs set nb_missions = nb_missions;
