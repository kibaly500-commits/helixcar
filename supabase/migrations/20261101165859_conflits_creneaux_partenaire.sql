-- Créneaux de travail : trajet complet (restitution comprise), ou horaires quotidiens sur place.
create function private.creneaux_mission(p jsonb) returns setof tsrange
language plpgsql immutable set search_path='' as $$
declare debut timestamp; fin timestamp; jour date; dernier date; h1 time; h2 time;
begin
 if p->>'type_mission'='convoyage' then
  debut:=nullif(p->>'date_prise_en_charge','')::timestamp;
  fin:=nullif(p->>'date_livraison','')::timestamp;
  if coalesce((p->>'restitution')::boolean,false) then
   fin:=greatest(fin,nullif(p->>'date_restitution_depart','')::timestamp,nullif(p->>'date_restitution_arrivee','')::timestamp);
  end if;
  if debut is null or fin is null then return; end if;
  return next tsrange(debut,greatest(fin,debut+interval '1 minute'),'[)');
 else
  jour:=nullif(p->>'date_intervention','')::date;
  dernier:=coalesce(nullif(p->>'date_fin_intervention','')::date,jour);
  if jour is null or dernier<jour then return; end if;
  -- Sans horaires précis, la journée est réservée plutôt que présumée libre.
  h1:=coalesce(nullif(p->>'heure_debut_intervention','')::time,case when p->>'heure_intervention' ~ '^\d{2}:\d{2}(:\d{2})?$' then (p->>'heure_intervention')::time end,'00:00'::time);
  h2:=nullif(p->>'heure_fin_intervention','')::time;
  while jour<=dernier loop
   debut:=jour+h1;fin:=case when h2 is null then (jour+1)::timestamp when h2<=h1 then (jour+1)+h2 else jour+h2 end;
   return next tsrange(debut,fin,'[)');jour:=jour+1;
  end loop;
 end if;
end $$;
revoke all on function private.creneaux_mission(jsonb) from public,anon,authenticated;

create function private.verifier_creneau_partenaire(p_convoyeur uuid,p_mission jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Même verrou pour candidatures, attributions et changements d'horaires.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('planning-partenaire:'||p_convoyeur::text,0));
 if not exists(select 1 from private.creneaux_mission(p_mission)) then raise exception 'Horaires de mission à préciser avant de postuler ou attribuer'; end if;
 if exists(
  select 1 from public.missions m
  cross join lateral private.creneaux_mission(to_jsonb(m)) occupe
  cross join lateral private.creneaux_mission(p_mission) demande
  where m.id::text is distinct from p_mission->>'id'
   and m.statut not in ('annule','annulee','terminee','fini')
   and (m.convoyeur_id=p_convoyeur or exists(select 1 from public.opportunite_candidatures c join public.opportunites o on o.id=c.opportunite_id where o.mission_id=m.id and c.convoyeur_id=p_convoyeur and c.etat='retenu'))
   and occupe && demande
 ) then raise exception 'Créneau indisponible : une mission déjà attribuée chevauche ces horaires, restitution comprise'; end if;
end $$;
revoke all on function private.verifier_creneau_partenaire(uuid,jsonb) from public,anon,authenticated;

create function private.garder_creneau_candidature() returns trigger
language plpgsql security definer set search_path='' as $$
declare m jsonb;
begin
 if new.etat not in ('a_etudier','preselectionne','retenu') then return new; end if;
 if tg_op='UPDATE' then
  if new.etat<>'retenu' or old.etat='retenu' then return new; end if;
 end if;
 select to_jsonb(x) into m from public.missions x join public.opportunites o on o.mission_id=x.id where o.id=new.opportunite_id;
 if m is null then raise exception 'Mission introuvable'; end if;
 perform private.verifier_creneau_partenaire(new.convoyeur_id,m);
 return new;
end $$;
revoke all on function private.garder_creneau_candidature() from public,anon,authenticated;
create trigger garde_creneau_partenaire before insert or update of etat on public.opportunite_candidatures for each row execute function private.garder_creneau_candidature();

create function private.garder_creneau_mission() returns trigger
language plpgsql security definer set search_path='' as $$
declare partenaire uuid;
begin
 if new.statut in ('annule','annulee','terminee','fini') then return new; end if;
 if tg_op='UPDATE' then
  if new.convoyeur_id is not distinct from old.convoyeur_id and old.statut not in ('annule','annulee','terminee','fini') and
   (new.date_prise_en_charge,new.date_livraison,new.date_restitution_depart,new.date_restitution_arrivee,new.restitution,new.date_intervention,new.date_fin_intervention,new.heure_intervention,new.heure_debut_intervention,new.heure_fin_intervention)
   is not distinct from
   (old.date_prise_en_charge,old.date_livraison,old.date_restitution_depart,old.date_restitution_arrivee,old.restitution,old.date_intervention,old.date_fin_intervention,old.heure_intervention,old.heure_debut_intervention,old.heure_fin_intervention) then return new; end if;
 end if;
 for partenaire in select new.convoyeur_id where new.convoyeur_id is not null union select c.convoyeur_id from public.opportunite_candidatures c join public.opportunites o on o.id=c.opportunite_id where o.mission_id=new.id and c.etat='retenu' loop
  perform private.verifier_creneau_partenaire(partenaire,to_jsonb(new));
 end loop;
 return new;
end $$;
revoke all on function private.garder_creneau_mission() from public,anon,authenticated;
create trigger garde_creneau_partenaire before insert or update on public.missions for each row execute function private.garder_creneau_mission();

-- Inclure aussi les missions collectives retenues, sans fabriquer une attribution individuelle.
create function private.missions_du_partenaire() returns jsonb
language plpgsql security definer set search_path='' as $$
declare partenaire uuid; resultat jsonb;
begin
 partenaire:=public.convoyeur_de_session();
 if auth.uid() is null or partenaire is null or not public.partenaire_actif() then raise exception 'Accès partenaire requis'; end if;
 select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('partenaire_retenu',true)),'[]'::jsonb) into resultat
 from public.missions m where m.statut in ('en_attente','proposee','acceptee','en_cours','restitution_requise','restitution_en_cours','edl_termine','fini','terminee','annulee') and (m.convoyeur_id=partenaire or exists(select 1 from public.opportunite_candidatures c join public.opportunites o on o.id=c.opportunite_id where o.mission_id=m.id and c.convoyeur_id=partenaire and c.etat='retenu'));
 return resultat;
end $$;
revoke all on function private.missions_du_partenaire() from public,anon;
grant execute on function private.missions_du_partenaire() to authenticated;
create function public.missions_du_partenaire() returns jsonb language sql security invoker set search_path='' as $$select private.missions_du_partenaire()$$;
revoke all on function public.missions_du_partenaire() from public,anon;
grant execute on function public.missions_du_partenaire() to authenticated;
