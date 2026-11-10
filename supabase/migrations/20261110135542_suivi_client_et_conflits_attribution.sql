-- Dates civiles françaises : conserver la demande et ses documents, sans supprimer de données.
create or replace function private.fin_prestation_json(p jsonb) returns timestamp
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; d timestamp; dernier timestamp;
begin
 if jsonb_typeof(p)='array' then
  for v in select value from jsonb_array_elements(p) loop dernier:=greatest(dernier,private.fin_prestation_json(v)); end loop;
 elsif jsonb_typeof(p)='object' then
  for k,v in select * from jsonb_each(p) loop
   if jsonb_typeof(v) in ('object','array') then
    if k in ('vehicules','nettoyage_details','professionnel_details') then dernier:=greatest(dernier,private.fin_prestation_json(v)); end if;
   elsif k in ('date_prise_en_charge','date_livraison','date_restitution','restit_date','stockage_date_debut','stockage_date_fin','date_debut','date_fin','date_souhaitee') and (v#>>'{}') ~ '^\d{4}-\d{2}-\d{2}' then
    begin
     -- Une date sans heure reste valable jusqu'à la fin de cette journée.
     d:=case when length(v#>>'{}')=10 then (v#>>'{}')::date+time '23:59:59' else (v#>>'{}')::timestamp end;
     dernier:=greatest(dernier,d);
    exception when invalid_datetime_format or datetime_field_overflow then null;
    end;
   end if;
  end loop;
 end if;
 return dernier;
end $$;
revoke all on function private.fin_prestation_json(jsonb) from public,anon;
grant execute on function private.fin_prestation_json(jsonb) to authenticated,service_role;

-- Étendre les projections existantes sans changer leurs filtres de propriétaire.
do $$declare def text;begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='v_mes_demandes' and column_name='prestation_depassee') then
  select pg_get_viewdef('public.v_mes_demandes'::regclass,true) into def;
  execute 'create or replace view public.v_mes_demandes as select d.*,coalesce(greatest(private.fin_prestation_json(to_jsonb(d)),(select max(private.fin_prestation_json(to_jsonb(v))) from public.vehicules v where v.dossier_id=d.id)) < (now() at time zone ''Europe/Paris''),false) prestation_depassee from ('||rtrim(btrim(def),';')||') d';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='v_mes_devis' and column_name='prestation_depassee') then
  select pg_get_viewdef('public.v_mes_devis'::regclass,true) into def;
  execute 'create or replace view public.v_mes_devis as select d.*,dv.motif_refus,coalesce(greatest(private.fin_prestation_json(to_jsonb(c)),(select max(private.fin_prestation_json(to_jsonb(v))) from public.vehicules v where v.dossier_id=c.id)) < (now() at time zone ''Europe/Paris''),false) prestation_depassee from ('||rtrim(btrim(def),';')||') d join public.devis dv on dv.id=d.id join public.clients c on c.id=d.client_id';
 end if;
end $$;

create or replace function private.etat_echeance_devis(p_devis uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c jsonb; fin timestamp;
begin
 select to_jsonb(cl) into c from public.clients cl join public.devis d on d.client_id=cl.id where d.id=p_devis and
 (cl.auth_user_id=auth.uid() or public.est_admin() or auth.jwt()->>'role'='service_role');
 if c is null then raise exception 'Devis non accessible' using errcode='42501'; end if;
 select greatest(private.fin_prestation_json(c),max(private.fin_prestation_json(to_jsonb(v)))) into fin from public.vehicules v where v.dossier_id=(c->>'id')::uuid;
 return coalesce(fin<(now() at time zone 'Europe/Paris'),false);
end $$;
revoke all on function private.etat_echeance_devis(uuid) from public,anon;
grant execute on function private.etat_echeance_devis(uuid) to authenticated,service_role;
create or replace function public.etat_echeance_devis(p_devis uuid) returns boolean language sql security invoker set search_path='' as $$select private.etat_echeance_devis(p_devis)$$;
revoke all on function public.etat_echeance_devis(uuid) from public,anon;
grant execute on function public.etat_echeance_devis(uuid) to authenticated,service_role;

-- Garde transactionnelle : un appel direct ne peut pas accepter/refuser un dossier dépassé.
create or replace function private.garder_echeance_devis() returns trigger
language plpgsql security definer set search_path='' as $$
declare c jsonb; fin timestamp;
begin
 if new.statut is not distinct from old.statut or new.statut not in ('accepte','refuse') then return new; end if;
 select to_jsonb(cl) into c from public.clients cl where cl.id=new.client_id;
 select greatest(private.fin_prestation_json(c),max(private.fin_prestation_json(to_jsonb(v)))) into fin from public.vehicules v where v.dossier_id=new.client_id;
 if fin<(now() at time zone 'Europe/Paris') then raise exception 'La date prévue est dépassée. Veuillez effectuer une nouvelle demande.'; end if;
 return new;
end $$;
revoke all on function private.garder_echeance_devis() from public,anon,authenticated;
drop trigger if exists garde_echeance_devis on public.devis;
create trigger garde_echeance_devis before update of statut on public.devis for each row execute function private.garder_echeance_devis();

-- Seules les candidatures en attente incompatibles sont écartées. Les offres restent ouvertes.
alter table public.opportunite_candidatures add column if not exists motif_decision text;
create or replace function private.ecarter_candidatures_incompatibles(p_partenaire uuid,p_mission jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('planning-partenaire:'||p_partenaire::text,0));
 update public.opportunite_candidatures c set etat='non_retenu',decidee_le=now(),decidee_par=auth.uid(),motif_decision='Indisponible : autre mission attribuée sur ce créneau, restitution comprise.'
 from public.opportunites o join public.missions m on m.id=o.mission_id
 where c.opportunite_id=o.id and c.convoyeur_id=p_partenaire and c.etat in ('a_etudier','preselectionne')
 and m.id::text is distinct from p_mission->>'id'
 and exists(select 1 from private.creneaux_mission(to_jsonb(m)) candidat cross join private.creneaux_mission(p_mission) attribue where candidat && attribue);
end $$;
revoke all on function private.ecarter_candidatures_incompatibles(uuid,jsonb) from public,anon,authenticated;
create or replace function private.synchroniser_candidatures_attribution() returns trigger
language plpgsql security definer set search_path='' as $$
declare m jsonb; partenaire uuid;
begin
 if tg_table_name='opportunite_candidatures' then
  if new.etat<>'retenu' then return new; end if;
  if tg_op='UPDATE' and old.etat='retenu' then return new; end if;
  select to_jsonb(x) into m from public.missions x join public.opportunites o on o.mission_id=x.id where o.id=new.opportunite_id;
  perform private.ecarter_candidatures_incompatibles(new.convoyeur_id,m);
 else
  if new.statut in ('annule','annulee','terminee','fini') then return new; end if;
  for partenaire in select new.convoyeur_id where new.convoyeur_id is not null union select c.convoyeur_id from public.opportunite_candidatures c join public.opportunites o on o.id=c.opportunite_id where o.mission_id=new.id and c.etat='retenu' loop
   perform private.ecarter_candidatures_incompatibles(partenaire,to_jsonb(new));
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.synchroniser_candidatures_attribution() from public,anon,authenticated;
drop trigger if exists synchroniser_candidatures_attribution on public.opportunite_candidatures;
create trigger synchroniser_candidatures_attribution after insert or update of etat on public.opportunite_candidatures for each row execute function private.synchroniser_candidatures_attribution();
drop trigger if exists synchroniser_candidatures_attribution on public.missions;
create trigger synchroniser_candidatures_attribution after insert or update on public.missions for each row execute function private.synchroniser_candidatures_attribution();

create or replace function private.missions_partenaire_admin(p_partenaire uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare resultat jsonb;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by coalesce(m.date_prise_en_charge,m.date_intervention::timestamp) desc),'[]'::jsonb) into resultat from public.missions m
 where m.convoyeur_id=p_partenaire or exists(select 1 from public.opportunite_candidatures c join public.opportunites o on o.id=c.opportunite_id where o.mission_id=m.id and c.convoyeur_id=p_partenaire and c.etat='retenu');
 return resultat;
end $$;
revoke all on function private.missions_partenaire_admin(uuid) from public,anon;
grant execute on function private.missions_partenaire_admin(uuid) to authenticated;
create or replace function public.missions_partenaire_admin(p_partenaire uuid) returns jsonb language sql security invoker set search_path='' as $$select private.missions_partenaire_admin(p_partenaire)$$;
revoke all on function public.missions_partenaire_admin(uuid) from public,anon;
grant execute on function public.missions_partenaire_admin(uuid) to authenticated;

-- Réétudier une candidature est soumis au même contrôle qu'une première candidature.
create or replace function private.garder_creneau_candidature() returns trigger
language plpgsql security definer set search_path='' as $$
declare m jsonb;
begin
 if new.etat not in ('a_etudier','preselectionne','retenu') then return new; end if;
 if tg_op='UPDATE' and new.etat=old.etat and new.convoyeur_id=old.convoyeur_id and new.opportunite_id=old.opportunite_id then return new; end if;
 select to_jsonb(x) into m from public.missions x join public.opportunites o on o.mission_id=x.id where o.id=new.opportunite_id;
 if m is null then raise exception 'Mission introuvable'; end if;
 perform private.verifier_creneau_partenaire(new.convoyeur_id,m);
 return new;
end $$;
revoke all on function private.garder_creneau_candidature() from public,anon,authenticated;

-- Le partenaire ne reçoit que le motif de sa propre candidature.
do $$declare def text;begin
 if to_regclass('public.v_opportunites_partenaire') is not null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='v_opportunites_partenaire' and column_name='ma_candidature_motif') then
  select pg_get_viewdef('public.v_opportunites_partenaire'::regclass,true) into def;
  execute 'create or replace view public.v_opportunites_partenaire as select o.*,c.motif_decision ma_candidature_motif from ('||rtrim(btrim(def),';')||') o left join public.opportunite_candidatures c on c.opportunite_id=o.id and c.convoyeur_id=public.convoyeur_de_session()';
 end if;
end $$;

-- Corriger aussi les candidatures déjà déposées pour une attribution encore active.
-- Les missions terminées/annulées et les créneaux entièrement passés restent intacts.
do $$declare ligne record;begin
 for ligne in
  select distinct m.id,p.partenaire,to_jsonb(m) mission from public.missions m
  cross join lateral (select m.convoyeur_id partenaire where m.convoyeur_id is not null union select c.convoyeur_id from public.opportunite_candidatures c join public.opportunites o on o.id=c.opportunite_id where o.mission_id=m.id and c.etat='retenu') p
  where coalesce(m.statut,'') not in ('annule','annulee','terminee','fini')
  and exists(select 1 from private.creneaux_mission(to_jsonb(m)) c where upper(c)>(now() at time zone 'Europe/Paris'))
  order by p.partenaire,m.id
 loop perform private.ecarter_candidatures_incompatibles(ligne.partenaire,ligne.mission); end loop;
end $$;
