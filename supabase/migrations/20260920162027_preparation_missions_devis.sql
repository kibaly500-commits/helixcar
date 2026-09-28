-- Préparation depuis la demande payée. Brouillons privés et publication explicite.
-- Aucun dossier existant n'est converti pendant la migration.
create table public.preparations_missions (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 devis_id uuid not null references public.devis(id),
 cle text not null,
 empreinte text not null,
 plan jsonb not null,
 annonce jsonb not null,
 mission_id uuid references public.missions(id),
 updated_at timestamptz not null default now(),
 unique(client_id,cle), unique(mission_id)
);
alter table public.preparations_missions enable row level security;
revoke all on public.preparations_missions from public,anon,authenticated;
grant select on public.preparations_missions to authenticated;
create policy preparations_admin on public.preparations_missions for select to authenticated using ((select public.est_admin()));
create index preparations_devis_idx on public.preparations_missions(devis_id);
alter table public.missions add column preparation_id uuid references public.preparations_missions(id);
create unique index missions_preparation_unique on public.missions(preparation_id) where preparation_id is not null;
alter table public.missions drop constraint missions_type_mission_check;
alter table public.missions add constraint missions_type_mission_check check(type_mission in ('convoyage','nettoyage','professionnel'));

-- Accès intégral réservé aux retenus, y compris les prestations à plusieurs partenaires.
create policy missions_preparation_privee on public.missions as restrictive for all to authenticated
using (preparation_id is null or public.est_admin() or (statut <> 'brouillon' and (
 convoyeur_id=public.convoyeur_de_session() or exists(select 1 from public.opportunite_candidatures ca join public.opportunites o on o.id=ca.opportunite_id where o.mission_id=missions.id and ca.convoyeur_id=public.convoyeur_de_session() and ca.etat='retenu'))))
with check (preparation_id is null or public.est_admin() or convoyeur_id=public.convoyeur_de_session());

create function public.source_preparation_missions(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; vs jsonb; d jsonb; source jsonb;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 select to_jsonb(x)-'vue_admin_at' into c from public.clients x where id=p_client_id;
 if c is null then raise exception 'Demande introuvable'; end if;
 select to_jsonb(x) into d from public.devis x where client_id=p_client_id and statut='accepte' and paiement_statut='paye' order by date_generation desc limit 1;
 if d is null then raise exception 'Le devis doit être accepté et le paiement confirmé'; end if;
 select coalesce(jsonb_agg(to_jsonb(v) order by position,id),'[]'::jsonb) into vs from public.vehicules v where dossier_id=p_client_id;
 source:=jsonb_build_object('client',c,'vehicules',vs,'devis_id',d->'id','point_remise','Point de remise HelixCar — ALDI, 12 rue de l’Université, 93160 Noisy-le-Grand');
 return source||jsonb_build_object('empreinte',md5(source::text),'reference',d->>'reference',
   'brouillons',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.preparations_missions p where client_id=p_client_id));
end $$;
revoke all on function public.source_preparation_missions(uuid) from public,anon;
grant execute on function public.source_preparation_missions(uuid) to authenticated;

-- Retire aussi les identifiants connus du dossier, même glissés dans un modèle/une ville.
create function public.texte_public_preparation(p_text text,p_source jsonb) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
declare result text:=coalesce(p_text,''); k text; v jsonb; sub jsonb;
begin
 if jsonb_typeof(p_source)='object' then
  for k,v in select * from jsonb_each(p_source) loop
   if jsonb_typeof(v) in ('object','array') then result:=public.texte_public_preparation(result,v);
   elsif k ~* '(nom$|prenom$|societe$|siret$|email$|telephone$|_tel$|immatriculation$|vin$|adresse.*rue$|adresse_restitution$)' and length(v#>>'{}')>=2 then
    result:=replace(result,v#>>'{}','');
   end if;
  end loop;
 elsif jsonb_typeof(p_source)='array' then
  for sub in select value from jsonb_array_elements(p_source) loop result:=public.texte_public_preparation(result,sub); end loop;
 end if;
 result:=public.hc_sans_coordonnees(result);
 result:=regexp_replace(result,'\m[A-HJ-NPR-Z0-9]{17}\M|\m[A-Z]{2}[- ]?[0-9]{3}[- ]?[A-Z]{2}\M','','g');
 return btrim(result);
end $$;
revoke all on function public.texte_public_preparation(text,jsonb) from public,anon,authenticated;

create function public.enregistrer_preparation_missions(p_client_id uuid,p_empreinte text,p_plans jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare src jsonb; p jsonb; a jsonb; r jsonb; lignes jsonb; keys text[]:='{}'; cat text;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 perform 1 from public.clients where id=p_client_id for update;
 src:=public.source_preparation_missions(p_client_id);
 if src->>'empreinte' is distinct from p_empreinte then raise exception 'La demande a changé. Rouvrez la préparation pour reprendre les informations actualisées.'; end if;
 if jsonb_typeof(p_plans)<>'array' or jsonb_array_length(p_plans)>500 then raise exception 'Préparation invalide'; end if;
 for p in select value from jsonb_array_elements(p_plans) loop
  if length(coalesce(p->>'key',''))=0 or (p->>'key')=any(keys) then raise exception 'Clé de mission invalide'; end if;
  keys:=array_append(keys,p->>'key');cat:=p->>'category';
  if cat not in ('convoyage','nettoyage','renfort','technicien') or cat is null then raise exception 'Métier à préciser'; end if;
  if nullif(p->>'vehicule_id','') is not null and not exists(select 1 from public.vehicules where id=(p->>'vehicule_id')::uuid and dossier_id=p_client_id) then raise exception 'Véhicule hors dossier'; end if;
  if nullif(p->>'remuneration','') is not null and ((p->>'remuneration')::numeric<0 or (p->>'remuneration')::numeric>1000000) then raise exception 'Prix de mission invalide'; end if;
  if exists(select 1 from public.preparations_missions x where x.client_id=p_client_id and x.cle=p->>'key' and x.mission_id is not null) then continue; end if;
  lignes:='[]'::jsonb;
  for r in select value from jsonb_array_elements(coalesce(p->'public'->'rows','[]'::jsonb)) loop
   lignes:=lignes||jsonb_build_array(jsonb_build_object('label',public.texte_public_preparation(r->>'label',src->'client'),'value',public.texte_public_preparation(r->>'value',src)));
  end loop;
  a:=jsonb_build_object('title',public.texte_public_preparation(p->>'title',src),'category',cat,'rows',lignes,
    'remuneration',p->'remuneration','nb_professionnels',greatest(1,coalesce((p->>'nb_professionnels')::int,1)));
  insert into public.preparations_missions(client_id,devis_id,cle,empreinte,plan,annonce)
  values(p_client_id,(src->>'devis_id')::uuid,p->>'key',p_empreinte,p-'public',a)
  on conflict(client_id,cle) do update set devis_id=excluded.devis_id,empreinte=excluded.empreinte,plan=excluded.plan,annonce=excluded.annonce,updated_at=now() where preparations_missions.mission_id is null;
 end loop;
 delete from public.preparations_missions where client_id=p_client_id and mission_id is null and not(cle=any(keys));
 return public.source_preparation_missions(p_client_id);
end $$;
revoke all on function public.enregistrer_preparation_missions(uuid,text,jsonb) from public,anon;
grant execute on function public.enregistrer_preparation_missions(uuid,text,jsonb) to authenticated;

-- Les nouveaux plans se figent à la publication. L'ancienne synchronisation
-- de recette ne doit pas transformer un trajet vers le stockage en trajet direct.
do $$ declare def text; begin
 select pg_get_functiondef('public.synchroniser_brouillon_vehicule_test()'::regprocedure) into def;
 if position('where vehicule_source_id=new.id' in def)=0 then raise exception 'Synchronisation inattendue'; end if;
 execute replace(def,'where vehicule_source_id=new.id','where preparation_id is null and vehicule_source_id=new.id');
end $$;

create function public.garder_preparation_mission() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.preparations_missions%rowtype; m public.missions%rowtype;
begin
 if tg_table_name='missions' then
  m:=new;
  if tg_op='UPDATE' and old.preparation_id is not null and new.preparation_id is distinct from old.preparation_id then raise exception 'Préparation immuable'; end if;
 else
  select * into m from public.missions where id=new.mission_id;
 end if;
 if m.preparation_id is null then return new; end if;
 select * into p from public.preparations_missions where id=m.preparation_id;
 if p.client_id is distinct from m.client_id then raise exception 'Dossier incohérent'; end if;
 if m.statut='annulee' then return new; end if;
 if (tg_table_name='missions' and m.statut='brouillon') or (tg_table_name='opportunites' and new.statut='brouillon') then return new; end if;
 if not exists(select 1 from public.devis where id=p.devis_id and client_id=m.client_id and statut='accepte' and paiement_statut='paye') then raise exception 'Paiement non confirmé'; end if;
 if m.remuneration_prevue is null or m.remuneration_prevue<=0 then raise exception 'Renseignez le prix total de la mission'; end if;
 if exists(select 1 from public.informations_demande(m.client_id) where statut not in ('fournie','validee')) then raise exception 'Informations manquantes ou en attente de validation'; end if;
 return new;
end $$;
revoke all on function public.garder_preparation_mission() from public,anon,authenticated;
create trigger garde_preparation_mission before insert or update on public.missions for each row execute function public.garder_preparation_mission();
create trigger garde_preparation_opportunite before insert or update on public.opportunites for each row execute function public.garder_preparation_mission();

create function public.publier_preparation_mission(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.preparations_missions%rowtype; src jsonb; m public.missions%rowtype; ancien public.missions%rowtype;
 safe jsonb; oid uuid; rep jsonb; desc_pub text; cols text; is_test boolean;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 select * into p from public.preparations_missions where id=p_id;
 if not found then raise exception 'Brouillon introuvable'; end if;
 perform 1 from public.clients where id=p.client_id for update;
 select * into p from public.preparations_missions where id=p_id for update;
 if p.mission_id is not null then
  select id into oid from public.opportunites where mission_id=p.mission_id;
  return jsonb_build_object('ok',true,'code','DEJA_PUBLIEE','opportunite_id',oid);
 end if;
 src:=public.source_preparation_missions(p.client_id);
 if p.empreinte is distinct from src->>'empreinte' then raise exception 'La demande a changé. Rouvrez la préparation.'; end if;
 if exists(select 1 from public.informations_demande(p.client_id) where statut not in ('fournie','validee')) then raise exception 'Informations manquantes ou en attente de validation'; end if;
 if jsonb_array_length(coalesce(p.plan->'missing','[]'::jsonb))>0 then raise exception 'Complétez les informations de préparation'; end if;
 if coalesce((p.plan->>'remuneration')::numeric,0)<=0 then raise exception 'Renseignez le prix total de la mission'; end if;
 if p.plan->>'category'='convoyage' and (nullif(p.plan->>'motorisation','') is null or coalesce((p.plan->>'distance')::numeric,-1)<0) then raise exception 'Complétez la distance et la motorisation'; end if;
 if p.plan->'mission'->>'restitution'='true' and nullif(p.plan->>'restit_motorisation','') is null then raise exception 'Complétez la motorisation du véhicule à restituer'; end if;
 if p.plan->>'category'='convoyage' and (nullif(p.plan->'mission'->>'date_prise_en_charge','') is null or nullif(p.plan->'mission'->>'date_livraison','') is null or (p.plan->'mission'->>'date_livraison')::timestamp < (p.plan->'mission'->>'date_prise_en_charge')::timestamp) then raise exception 'Complétez les horaires et vérifiez la chronologie du trajet'; end if;
 if p.plan->>'date_debut' is null or p.plan->>'date_fin' is null or (p.plan->>'date_fin')::date<(p.plan->>'date_debut')::date then raise exception 'Vérifiez les dates'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe from jsonb_each(p.plan->'mission') where key=any(array[
 'type_mission','ville_depart','ville_arrivee','type_vehicule','marque_modele','immatriculation','vin','adresse_depart','adresse_arrivee','contact_depart_nom','contact_depart_tel','contact_arrivee_nom','contact_arrivee_tel','date_prise_en_charge','date_livraison','plateau','consignes','nb_vehicules','restitution','adresse_restitution','restit_contact_nom','restit_contact_tel','restit_marque_modele','restit_immatriculation','restit_vin','restit_info','date_restitution_depart','prestation','adresse_intervention','code_postal_intervention','ville_intervention','contact_nom','contact_tel','date_intervention','date_fin_intervention','heure_intervention','heure_debut_intervention','heure_fin_intervention']);
 if safe->>'type_mission' not in ('convoyage','nettoyage','professionnel') then raise exception 'Type de mission invalide'; end if;
 -- Réutilisation d'un ancien brouillon payé ou du nettoyage créé par le serveur.
 select * into ancien from public.missions x where x.client_id=p.client_id and x.preparation_id is null and x.statut<>'annulee'
 and ((safe->>'type_mission'='nettoyage' and x.type_mission='nettoyage') or
 (safe->>'type_mission'='convoyage' and x.vehicule_source_id=nullif(p.plan->>'vehicule_id','')::uuid and x.devis_source_id=p.devis_id))
 order by created_at limit 1 for update;
 if ancien.id is not null then
  if ancien.convoyeur_id is not null or ancien.statut not in ('brouillon','en_attente') or exists(select 1 from public.opportunites where mission_id=ancien.id and statut<>'brouillon') then raise exception 'Une mission est déjà engagée pour ce véhicule. Ouvrez son opportunité existante.'; end if;
  safe:=to_jsonb(ancien)||safe;
 end if;
 select exists(select 1 from public.paiement_evenements where devis_id=p.devis_id and detail->>'livemode'='false') into is_test;
 safe:=safe||jsonb_build_object('id',coalesce(ancien.id,gen_random_uuid()),'reference',coalesce(ancien.reference,case when is_test then 'TEST-' else '' end||'M-'||substr(replace(p.id::text,'-',''),1,16)),
 'ville_depart',coalesce(safe->>'ville_depart',''),'ville_arrivee',coalesce(safe->>'ville_arrivee',''),'client_id',p.client_id,'preparation_id',p.id,'vehicule_source_id',nullif(p.plan->>'vehicule_id','')::uuid,'statut','brouillon',
 'created_at',coalesce(ancien.created_at,now()::timestamp),'remuneration_prevue',(p.plan->>'remuneration')::numeric,'distance_km',nullif(p.plan->>'distance','')::int);
 if p.plan->>'kind'='avant_stockage' then safe:=safe||jsonb_build_object('ville_arrivee','Noisy-le-Grand','adresse_arrivee',src->>'point_remise'); end if;
 if p.plan->>'kind'='apres_stockage' then safe:=safe||jsonb_build_object('ville_depart','Noisy-le-Grand','adresse_depart',src->>'point_remise'); end if;
 safe:=safe||jsonb_build_object('electrique',p.plan->>'motorisation'='Électrique');
 select * into m from jsonb_populate_record(null::public.missions,safe);
 if ancien.id is null then insert into public.missions select m.*;
 else
  select string_agg(format('%I=(jsonb_populate_record(null::public.missions,$1)).%I',key,key),',') into cols
   from jsonb_object_keys(safe) as keys(key) where key not in ('id','devis_source_id','vehicule_source_id','client_id','reference','created_at');
  execute 'update public.missions set '||cols||' where id=$2' using safe,ancien.id;
 end if;
 select id into oid from public.opportunites where mission_id=m.id;
 if oid is null then rep:=public.creer_brouillon_opportunite(m.id);oid:=(rep->>'id')::uuid; end if;
 if oid is null then raise exception 'Opportunité introuvable'; end if;
 select string_agg((value->>'label')||' : '||(value->>'value'),E'\n') into desc_pub from jsonb_array_elements(p.annonce->'rows');
 update public.opportunites set intitule=p.annonce->>'title',categorie=p.plan->>'category',
 date_debut=(p.plan->>'date_debut')::date,date_fin=(p.plan->>'date_fin')::date,zone_generale=public.texte_public_preparation(p.plan->>'zone',src),
 nb_professionnels=greatest(1,(p.plan->>'nb_professionnels')::int),badges_requis=array[p.plan->>'category'],description_publique=desc_pub,duree_texte=null
 where id=oid;
 rep:=public.publier_opportunite(oid);
 if not coalesce((rep->>'ok')::boolean,false) then raise exception 'Publication refusée : %',rep->>'code'; end if;
 update public.missions set statut='en_attente' where id=m.id and statut='brouillon';
 update public.preparations_missions set mission_id=m.id,updated_at=now() where id=p.id;
 return rep||jsonb_build_object('opportunite_id',oid,'mission_id',m.id);
end $$;
revoke all on function public.publier_preparation_mission(uuid) from public,anon;
grant execute on function public.publier_preparation_mission(uuid) to authenticated;

-- Projection publique explicite. Aucune coordonnée de mission ni JSON privé.
create or replace view public.v_opportunites_partenaire as
select o.id,o.statut,o.intitule,o.categorie,o.date_debut,o.date_fin,o.duree_texte,o.zone_generale,
 o.ponctuelle,o.statut_independant,o.badges_requis,o.nb_professionnels,o.description_publique,o.publiee_le,
 ca.etat as ma_candidature_etat,ca.created_at as ma_candidature_le,
 (m.devis_source_id is not null and m.preparation_id is null) as acceptation_directe,
 case when m.devis_source_id is not null then m.remuneration_prevue end as remuneration_prevue,
 case when m.devis_source_id is not null then m.date_prise_en_charge end as depart_prevu,
 case when m.devis_source_id is not null then m.date_livraison end as livraison_prevue,
 case when m.devis_source_id is not null then m.restitution end as restitution_prevue,
 case when m.devis_source_id is not null then m.plateau end as transport_plateau,
 p.annonce as preparation_annonce,case when ca.etat='retenu' then m.id end as mission_id
from public.opportunites o join public.missions m on m.id=o.mission_id
left join public.preparations_missions p on p.id=m.preparation_id
left join public.opportunite_candidatures ca on ca.opportunite_id=o.id and ca.convoyeur_id=public.convoyeur_de_session()
where public.partenaire_actif() and o.statut<>'brouillon' and (o.statut='a_pourvoir' or ca.id is not null)
 and (o.badges_requis && public.activites_validees_partenaire())
 and ((m.devis_source_id is null and not exists(select 1 from public.paiement_evenements e where e.devis_id=p.devis_id and e.detail->>'livemode'='false')) or
 (exists(select 1 from public.convoyeurs c where c.id=public.convoyeur_de_session() and lower(c.email) in ('kibaly500@gmail.com','kibaly500+qa-final01@gmail.com'))
 and (m.convoyeur_id is null or m.convoyeur_id=public.convoyeur_de_session())));
alter view public.v_opportunites_partenaire set (security_invoker=false,security_barrier=true);
-- Vue à privilèges propriétaires intentionnelle : permet la projection publique
-- sans autoriser la lecture des missions et des préparations privées.

do $$ declare def text; begin
 select pg_get_viewdef('public.v_opportunites_admin'::regclass,true) into def;
 def:=rtrim(btrim(def),';');
 execute 'create or replace view public.v_opportunites_admin as select v.*,p.annonce as preparation_annonce from ('||def||') v left join public.missions m on m.id=v.mission_id left join public.preparations_missions p on p.id=m.preparation_id';
end $$;
alter view public.v_opportunites_admin set(security_invoker=true);

create function public.retenu_preparation_mission(p_mission_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.opportunite_candidatures ca join public.opportunites o on o.id=ca.opportunite_id
 where o.mission_id=p_mission_id and ca.convoyeur_id=public.convoyeur_de_session() and ca.etat='retenu');
$$;
revoke all on function public.retenu_preparation_mission(uuid) from public,anon;
grant execute on function public.retenu_preparation_mission(uuid) to authenticated;
drop policy missions_preparation_privee on public.missions;
create policy missions_preparation_privee on public.missions as restrictive for all to authenticated
using (preparation_id is null or public.est_admin() or (statut<>'brouillon' and (convoyeur_id=public.convoyeur_de_session() or public.retenu_preparation_mission(id))))
with check (preparation_id is null or public.est_admin() or convoyeur_id=public.convoyeur_de_session());
create policy missions_preparation_retenus on public.missions for select to authenticated using (preparation_id is not null and public.partenaire_actif() and public.retenu_preparation_mission(id));

-- Réutilise la sélection existante, sans réinventer l'acceptation ni envoyer d'e-mail.
create function public.attribuer_preparation_retenue() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.missions%rowtype; o public.opportunites%rowtype;
begin
 select * into o from public.opportunites where id=new.opportunite_id;
 select * into m from public.missions where id=o.mission_id;
 if m.preparation_id is null then return null; end if;
 if tg_op='UPDATE' and old.etat='retenu' and new.etat<>'retenu' and m.convoyeur_id=new.convoyeur_id then
  update public.missions set convoyeur_id=null,statut=case when statut='acceptee' then 'en_attente' else statut end where id=m.id;
 end if;
 if new.etat='retenu' and o.nb_professionnels=1 and m.statut='en_attente' then
  update public.missions set convoyeur_id=new.convoyeur_id,statut='acceptee' where id=m.id;
 end if;
 return null;
end $$;
revoke all on function public.attribuer_preparation_retenue() from public,anon,authenticated;
create trigger attribuer_preparation_retenue after insert or update of etat on public.opportunite_candidatures for each row execute function public.attribuer_preparation_retenue();

-- Le point de remise correspond au seul trajet attribué.
CREATE OR REPLACE FUNCTION public.point_remise_mission(p_mission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m public.missions%rowtype; c public.clients%rowtype; v public.vehicules%rowtype;
 entree boolean; sortie boolean; preparation public.preparations_missions%rowtype;
begin
 if auth.uid() is null and coalesce(auth.jwt()->>'role','')<>'service_role' then return null; end if;
 select * into m from public.missions where id=p_mission_id;
 if not found then return null; end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not public.est_admin() and not exists(
  select 1 from public.convoyeurs cv where cv.id=m.convoyeur_id and cv.auth_user_id=auth.uid()
 ) then return null; end if;
 select * into c from public.clients where id=m.client_id;
 if m.preparation_id is not null then
  select * into preparation from public.preparations_missions where id=m.preparation_id;
  if not exists(select 1 from public.devis where id=preparation.devis_id and statut='accepte' and paiement_statut='paye') then return null; end if;
  if preparation.plan->>'kind' not in ('avant_stockage','apres_stockage') then return null; end if;
  return jsonb_build_object('adresse','ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand','arriveeAvantStockage',preparation.plan->>'kind'='avant_stockage','departApresStockage',preparation.plan->>'kind'='apres_stockage');
 end if;
 if c.type_service not in ('stockage','convoyage_stockage') then return null; end if;
 if not exists(select 1 from public.devis where client_id=c.id and statut='accepte' and paiement_statut='paye') then return null; end if;
 select * into v from public.vehicules where id=m.vehicule_source_id;
 entree:=c.stockage_acheminement='helixcar';
 sortie:=c.stockage_sortie='helixcar' and coalesce(v.livraison_apres_stockage,true);
 if not coalesce(entree,false) and not coalesce(sortie,false) then return null; end if;
 return jsonb_build_object('adresse','ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand',
   'arriveeAvantStockage',coalesce(entree,false),'departApresStockage',coalesce(sortie,false));
end $function$
;

-- Les anciennes missions automatiques de dossiers payés ne doivent pas exposer
-- leurs coordonnées dans la liste historique des missions non attribuées.
create function public.mission_demande_payee(p_client_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.devis where client_id=p_client_id and statut='accepte' and paiement_statut='paye');
$$;
revoke all on function public.mission_demande_payee(uuid) from public,anon;
grant execute on function public.mission_demande_payee(uuid) to authenticated;
create policy missions_demande_coordonnees_privees on public.missions as restrictive for select to authenticated
using (public.est_admin() or (preparation_id is null and not public.mission_demande_payee(client_id)) or
 (statut<>'brouillon' and (convoyeur_id=public.convoyeur_de_session() or public.retenu_preparation_mission(id))));
