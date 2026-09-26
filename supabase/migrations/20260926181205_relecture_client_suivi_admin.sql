-- Relecture finale : valeurs réelles, modifications limitées, soumission atomique.
alter table public.clients add column if not exists informations_confirmees_le timestamptz;
alter table public.demande_informations_manquantes add column if not exists ancienne_valeur text;
alter table public.demande_informations_manquantes add column if not exists correction_recue boolean not null default false;
-- Aucun verrouillage rétroactif : le verrou sera posé à la prochaine confirmation client.
-- Toutes les réponses client passent par la RPC atomique et ses contrôles.
drop policy if exists "infos manquantes : reponse client" on public.demande_informations_manquantes;

create or replace function public.valeur_source_information(p_client_id uuid,p_cle text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; v jsonb; d jsonb; m text[]; k text:=p_cle; col text; result text;
begin
 select to_jsonb(x) into c from public.clients x where id=p_client_id;
 m:=regexp_match(k,'^vehicule_([0-9]+)_(.*)$');
 if m is not null then
  select to_jsonb(x) into v from public.vehicules x where dossier_id=p_client_id and position=m[1]::int;
  k:=m[2];
  col:=case k when 'contact_pc_nom' then 'pc_contact_nom' when 'contact_pc_tel' then 'pc_contact_tel' when 'contact_liv_nom' then 'liv_contact_nom' when 'contact_liv_tel' then 'liv_contact_tel' when 'adresse_depart' then 'adresse_depart_rue' when 'adresse_arrivee' then 'adresse_arrivee_rue' when 'restit_adresse' then 'restit_adresse_rue' when 'restit_consignes' then 'restit_contraintes' else k end;
  result:=nullif(btrim(v->>col),'');
  if result is not null then return result; end if;
  if not coalesce((c->>'trajet_commun')::boolean,false) then return null; end if;
  if k not in ('contact_pc_nom','contact_pc_tel','contact_liv_nom','contact_liv_tel','adresse_depart','adresse_arrivee','date_prise_en_charge') then return null; end if;
 end if;
 d:=case when c->>'type_service'='nettoyage' then c->'nettoyage_details' else c->'professionnel_details' end;
 if k='contact_sur_place_nom' then return d#>>'{contact_sur_place,nom}'; end if;
 if k='contact_sur_place_tel' then return d#>>'{contact_sur_place,telephone}'; end if;
 if k like 'nettoyage_%' then
  col:=case k when 'nettoyage_type' then 'type_nettoyage' when 'nettoyage_date' then 'date_souhaitee' when 'nettoyage_adresse' then 'adresse_rue' when 'nettoyage_ville' then 'adresse_ville' else substring(k from 11) end;
  if k='nettoyage_horaire' then return coalesce(d->>'heure_precise',concat_ws(' – ',d->>'creneau_debut',d->>'creneau_fin'));end if;
  return d->>col;
 end if;
 if k like 'professionnel_%' then
  if k='professionnel_besoin' then return concat_ws(' · ',d->>'categorie',coalesce(d->>'specialite',d->>'mission')); end if;
  if k='professionnel_horaires' then return concat_ws(' – ',d->>'heure_debut',d->>'heure_fin'); end if;
  col:=case k when 'professionnel_adresse' then 'adresse_rue' when 'professionnel_ville' then 'adresse_ville' else substring(k from 15) end;
  return d->>col;
 end if;
 col:=case k when 'adresse_depart' then 'adresse_depart_rue' when 'adresse_arrivee' then 'adresse_arrivee_rue' when 'restit_adresse' then 'adresse_restit_rue' when 'restit_date' then 'date_restitution' when 'consignes' then 'notes' when 'restit_consignes' then 'contraintes_restit' else k end;
 return c->>col;
end $$;
revoke all on function public.valeur_source_information(uuid,text) from public,anon,authenticated;

create or replace function public.information_modifiable_client(p_cle text) returns boolean
language sql immutable set search_path=public,pg_temp as $$
 select regexp_replace(p_cle,'^vehicule_[0-9]+_','') = any(array['immatriculation','vin','restit_immatriculation','restit_vin','contact_pc_nom','contact_pc_tel','contact_liv_nom','contact_liv_tel','restit_contact_nom','restit_contact_tel','contact_sur_place_nom','contact_sur_place_tel','consignes','restit_consignes']);
$$;
revoke all on function public.information_modifiable_client(text) from public,anon,authenticated;

do $patch$
declare def text; marker text;
begin
 select pg_get_functiondef('public.informations_demande(uuid)'::regprocedure) into def;
 if position('    i.valeur,' in def)=0 then raise exception 'Projection informations introuvable';end if;
 def:=replace(def,'    i.valeur,','    coalesce(i.valeur,public.valeur_source_information(p_client_id,r->>''cle'')),');
 marker:='        prefixe := case when n_veh > 1 then ''Véhicule '' || rang::text || '' — '' else '''' end;';
 if position(marker in def)=0 then raise exception 'Groupement véhicules introuvable';end if;
 def:=replace(def,marker,marker || $extra$
        requis:=requis||jsonb_build_array(jsonb_build_object('cle','vehicule_'||rang::text||'_consignes','libelle',prefixe||'Consignes pratiques','fournie',true));
        if v.restitution_concernee then
          requis:=requis||jsonb_build_array(jsonb_build_object('cle','vehicule_'||rang::text||'_restit_consignes','libelle',prefixe||'Consignes pratiques de restitution','fournie',true));
        end if;
$extra$);
 execute def;
 select pg_get_functiondef('public.synchroniser_information_validee()'::regprocedure) into def;
 def:=replace(def,'declare m text[]; col text;','declare m text[]; col text; service text; details_col text;');
 def:=replace(def,' if m is null then return new; end if;',$sync$
 if m is null then
  if new.cle in ('contact_sur_place_nom','contact_sur_place_tel') then
   select type_service into service from clients where id=new.client_id;
   details_col:=case service when 'nettoyage' then 'nettoyage_details' when 'professionnel' then 'professionnel_details' end;
   if details_col is not null then
    execute format('update public.clients set %1$I=jsonb_set(coalesce(%1$I,''{}''::jsonb),''{contact_sur_place}'',coalesce(%1$I->''contact_sur_place'',''{}''::jsonb)||jsonb_build_object($1,$2)) where id=$3',details_col)
    using case new.cle when 'contact_sur_place_nom' then 'nom' else 'telephone' end,new.valeur,new.client_id;
   end if;
  elsif new.cle in ('immatriculation','vin','restit_immatriculation','restit_vin','contact_pc_nom','contact_pc_tel','contact_liv_nom','contact_liv_tel','restit_contact_nom','restit_contact_tel') then
   execute format('update public.clients set %I=$1 where id=$2',new.cle) using new.valeur,new.client_id;
  end if;
  return new;
 end if;
$sync$);
 def:=replace(def,$a$when 'immatriculation' then 'immatriculation'$a$,$b$when 'consignes' then 'consignes' when 'restit_consignes' then 'restit_contraintes' when 'immatriculation' then 'immatriculation'$b$);
 execute def;
end $patch$;

create or replace function public.contexte_completion_demande(p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.est_admin() or public.est_proprietaire_demande(p_client_id)) then raise exception 'Accès refusé' using errcode='42501';end if;
 return jsonb_build_object('verrouillee',(select informations_confirmees_le is not null from clients where id=p_client_id) or exists(select 1 from preparations_missions where client_id=p_client_id and mission_id is not null));
end $$;
revoke all on function public.contexte_completion_demande(uuid) from public,anon;
grant execute on function public.contexte_completion_demande(uuid) to authenticated;

create or replace function public.repondre_informations_demande(p_client_id uuid,p_reponses jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n int:=0; k text; j jsonb; v text; r record; verrou boolean; avant text;
begin
 if not public.est_proprietaire_demande(p_client_id) then raise exception 'Demande introuvable ou non autorisée.' using errcode='42501';end if;
 if jsonb_typeof(p_reponses) is distinct from 'object' then raise exception 'Informations invalides.' using errcode='22023';end if;
 select informations_confirmees_le is not null into verrou from clients where id=p_client_id for update;
 if exists(select 1 from preparations_missions where client_id=p_client_id and mission_id is not null) then raise exception 'Mission publiée : contactez HelixCar pour toute correction.' using errcode='22023';end if;
 for r in select * from informations_demande(p_client_id) where statut in ('attendue','a_corriger') loop
  j:=p_reponses->r.cle;
  if jsonb_typeof(j) is distinct from 'string' or nullif(btrim(j#>>'{}'),'') is null then raise exception 'Complétez toutes les informations obligatoires avant validation.' using errcode='22023';end if;
 end loop;
 for k,j in select key,value from jsonb_each(p_reponses) loop
  select * into r from informations_demande(p_client_id) where cle=k;
  if not found then raise exception 'Information non modifiable : %',k using errcode='22023';end if;
  if jsonb_typeof(j) is distinct from 'string' then raise exception 'Valeur invalide' using errcode='22023';end if;
  v:=btrim(j#>>'{}');
  -- Rejeu identique sans modification ni nouvelle notification.
  if v is not distinct from coalesce(r.valeur,'') and r.statut not in ('attendue','a_corriger') then continue;end if;
  if r.statut not in ('attendue','a_corriger') and not(not verrou and r.statut='fournie' and information_modifiable_client(k)) then
   raise exception 'Cette information est verrouillée : %',r.libelle using errcode='22023';
  end if;
  if verrou and r.statut not in ('attendue','a_corriger') then raise exception 'Informations déjà confirmées. Contactez HelixCar.' using errcode='22023';end if;
  if v='' then raise exception 'Une valeur est obligatoire : %',r.libelle using errcode='22023';end if;
  perform verifier_valeur_information(k,v);
  avant:=coalesce(r.valeur,valeur_source_information(p_client_id,k));
  insert into demande_informations_manquantes(client_id,cle,libelle,statut,valeur,commentaire,ancienne_valeur,correction_recue,transmise_le)
   values(p_client_id,k,r.libelle,'transmise',v,r.commentaire,avant,r.statut='a_corriger',now())
   on conflict(client_id,cle) do update set statut='transmise',valeur=excluded.valeur,ancienne_valeur=excluded.ancienne_valeur,correction_recue=excluded.correction_recue,transmise_le=now();
  n:=n+1;
 end loop;
 if n>0 or not verrou then update clients set informations_confirmees_le=coalesce(informations_confirmees_le,now()) where id=p_client_id;end if;
 return greatest(n,1);
end $$;
revoke all on function public.repondre_informations_demande(uuid,jsonb) from public,anon;
grant execute on function public.repondre_informations_demande(uuid,jsonb) to authenticated;

-- Sérialiser une publication avec la confirmation client du même dossier.
do $lock$
declare def text; marker text:=' if auth.uid() is null or not public.est_admin() then raise exception ''Accès réservé à HelixCar''; end if;';
begin
 select pg_get_functiondef('public.source_preparation_missions(uuid)'::regprocedure) into def;
 if position(marker in def)=0 then raise exception 'Contrôle administrateur source introuvable';end if;
 execute replace(def,marker,marker||E'\n perform 1 from public.clients where id=p_client_id for update;');
end $lock$;
