-- Validation minimale des saisies : les coordonnées restent à vérifier par l'administrateur.
create or replace function public.verifier_valeur_information(p_cle text,p_valeur text) returns void
language plpgsql immutable set search_path=public,pg_temp as $$
declare chiffres text;
begin
 if length(p_valeur)>2000 then raise exception 'Information trop longue : %',p_cle using errcode='22023'; end if;
 if p_cle ~ '(_tel|telephone)$' then
  chiffres:=regexp_replace(p_valeur,'[^0-9]','','g');
  if length(chiffres)<7 or length(chiffres)>15 or p_valeur !~ '^\+?[0-9 ()./-]+$' then
   raise exception 'Téléphone incomplet ou invalide : %. Indiquez le numéro complet, avec indicatif pour un numéro international.',p_cle using errcode='22023';
  end if;
 end if;
end $$;
revoke all on function public.verifier_valeur_information(text,text) from public,anon,authenticated;

create or replace function public.repondre_informations_demande(p_client_id uuid,p_reponses jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer:=0; affectees integer; k text; v text; j jsonb; lib text; etat text;
begin
 if not public.est_proprietaire_demande(p_client_id) then raise exception 'Demande introuvable ou non autorisée.' using errcode='42501'; end if;
 if jsonb_typeof(p_reponses) is distinct from 'object' then raise exception 'Informations invalides.' using errcode='22023'; end if;
 perform 1 from public.clients where id=p_client_id for update;
 delete from public.demande_informations_manquantes i where i.client_id=p_client_id and i.cle not in(select r.cle from public.informations_demande(p_client_id) r);
 for k,j in select key,value from jsonb_each(p_reponses) loop
  select r.libelle,r.statut into lib,etat from public.informations_demande(p_client_id) r where r.cle=k;
  if not found or etat in ('validee','fournie') then continue; end if;
  if jsonb_typeof(j) is distinct from 'string' then raise exception 'Valeur invalide : %',k using errcode='22023'; end if;
  v:=btrim(j #>> '{}'); if v='' then continue; end if;
  perform public.verifier_valeur_information(k,v);
  if exists(select 1 from public.demande_informations_manquantes where client_id=p_client_id and cle=k and statut='transmise' and valeur=v) then continue; end if;
  insert into public.demande_informations_manquantes(client_id,cle,libelle,statut,valeur,commentaire)
  values(p_client_id,k,lib,'transmise',v,null)
  on conflict(client_id,cle) do update set statut='transmise',valeur=excluded.valeur,commentaire=null
  where demande_informations_manquantes.statut <> 'validee'
    and not(demande_informations_manquantes.statut='transmise' and demande_informations_manquantes.valeur=excluded.valeur);
  get diagnostics affectees = row_count;
  n:=n+affectees;
 end loop;
 return n;
end $$;
revoke all on function public.repondre_informations_demande(uuid,jsonb) from public,anon;
grant execute on function public.repondre_informations_demande(uuid,jsonb) to authenticated;

create or replace function public.controler_decision_information() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.statut='a_corriger' and nullif(btrim(new.commentaire),'') is null then
  raise exception 'Un motif de correction est obligatoire.' using errcode='22023';
 end if;
 if new.statut in ('transmise','validee') then
  if nullif(btrim(new.valeur),'') is null then raise exception 'Une valeur est obligatoire.' using errcode='22023'; end if;
  perform public.verifier_valeur_information(new.cle,new.valeur);
 end if;
 return new;
end $$;
create trigger controler_decision_information before insert or update on public.demande_informations_manquantes
for each row execute function public.controler_decision_information();
-- Le trigger appelle un validateur non exposé, avec les privilèges de son propriétaire.
alter function public.controler_decision_information() security definer;
revoke all on function public.controler_decision_information() from public,anon,authenticated;

create or replace function public.synchroniser_information_validee() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare m text[]; col text;
begin
 if new.statut<>'validee' then return new; end if;
 m:=regexp_match(new.cle,'^vehicule_([0-9]+)_(.*)$');
 if m is null then return new; end if;
 col:=case m[2]
 when 'immatriculation' then 'immatriculation' when 'vin' then 'vin' when 'marque_modele' then 'marque_modele'
 when 'adresse_depart' then 'adresse_depart_rue' when 'adresse_arrivee' then 'adresse_arrivee_rue'
 when 'contact_pc_nom' then 'pc_contact_nom' when 'contact_pc_tel' then 'pc_contact_tel'
 when 'contact_liv_nom' then 'liv_contact_nom' when 'contact_liv_tel' then 'liv_contact_tel'
 when 'restit_contact_nom' then 'restit_contact_nom' when 'restit_contact_tel' then 'restit_contact_tel'
 when 'restit_adresse' then 'restit_adresse_rue' when 'restit_immatriculation' then 'restit_immatriculation'
 when 'restit_vin' then 'restit_vin' when 'restit_marque_modele' then 'restit_marque_modele' else null end;
 if col is not null then
  execute format('update public.vehicules set %I=$1 where dossier_id=$2 and position=$3',col) using new.valeur,new.client_id,m[1]::integer;
 elsif m[2]='date_prise_en_charge' then
  update public.vehicules set date_prise_en_charge=new.valeur::date where dossier_id=new.client_id and position=m[1]::integer;
 elsif m[2]='restit_date' then
  update public.vehicules set restit_date=new.valeur::date where dossier_id=new.client_id and position=m[1]::integer;
 end if;
 return new;
end $$;
revoke all on function public.synchroniser_information_validee() from public,anon,authenticated;
create trigger synchroniser_information_validee after insert or update on public.demande_informations_manquantes
for each row execute function public.synchroniser_information_validee();
