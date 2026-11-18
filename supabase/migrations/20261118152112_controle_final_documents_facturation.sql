-- Contrôle final unique, pièces privées par dossier/mission, facturation verrouillée.
create table public.pieces_mission (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients,
 mission_id uuid references public.missions, nom text not null check(length(nom) between 1 and 180),
 chemin text not null unique, auteur uuid not null default auth.uid(), auteur_role text not null,
 partage_partenaire boolean not null default false, partage_client boolean not null default false,
 obligatoire boolean not null default false, etat text not null default 'recu' check(etat in ('recu','valide','a_corriger')),
 commentaire text, created_at timestamptz not null default now()
);
create index on public.pieces_mission(mission_id);
create index on public.pieces_mission(client_id);
create table public.controles_fin_mission (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.missions,
 decision text not null check(decision in ('validee','a_corriger')), commentaire text,
 auteur uuid not null default auth.uid(), created_at timestamptz not null default now(),
 lettre_url text, edl_ids uuid[] not null default '{}'
);
create index on public.controles_fin_mission(mission_id,created_at desc);
alter table public.pieces_mission enable row level security;
alter table public.controles_fin_mission enable row level security;
revoke all on public.pieces_mission,public.controles_fin_mission from anon,authenticated;
grant select,insert,update on public.pieces_mission to authenticated;
grant select on public.controles_fin_mission to authenticated;
create function private.acces_dossier_piece(cid uuid,mid uuid,partage boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.est_admin()
 or exists(select 1 from public.clients c where c.id=cid and c.auth_user_id=auth.uid())
 or (partage and exists(select 1 from public.missions m join public.convoyeurs p on p.id=m.convoyeur_id
 where m.id=mid and m.client_id=cid and p.auth_user_id=auth.uid() and public.partenaire_actif())))
$$;
revoke all on function private.acces_dossier_piece(uuid,uuid,boolean) from public,anon;
grant execute on function private.acces_dossier_piece(uuid,uuid,boolean) to authenticated;
create policy pieces_lecture on public.pieces_mission for select to authenticated using (
 public.est_admin() or auteur=auth.uid() or (partage_client and exists(select 1 from public.clients c where c.id=client_id and c.auth_user_id=auth.uid()))
 or (partage_partenaire and exists(select 1 from public.missions m join public.convoyeurs p on p.id=m.convoyeur_id where m.id=mission_id and p.auth_user_id=auth.uid() and public.partenaire_actif()))
);
create policy pieces_creation on public.pieces_mission for insert to authenticated with check(private.acces_dossier_piece(client_id,mission_id,true) and auteur=auth.uid());
create policy pieces_modification on public.pieces_mission for update to authenticated using(public.est_admin()) with check(public.est_admin());
create policy controles_lecture on public.controles_fin_mission for select to authenticated using(public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs p on p.id=m.convoyeur_id where m.id=mission_id and p.auth_user_id=auth.uid()));
create function private.garder_piece_mission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Session requise'; end if;
 if new.mission_id is not null and not exists(select 1 from public.missions m where m.id=new.mission_id and m.client_id=new.client_id) then raise exception 'Mission et client incompatibles'; end if;
 if tg_op='INSERT' then
  new.auteur:=auth.uid();new.created_at:=now();new.etat:='recu';new.commentaire:=null;
  if new.chemin not like new.client_id::text||'/'||auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='pieces-missions' and name=new.chemin) then raise exception 'Fichier privé absent ou non autorisé'; end if;
  new.auteur_role:=case when public.est_admin() then 'HelixCar' when exists(select 1 from public.clients c where c.id=new.client_id and c.auth_user_id=auth.uid()) then 'Client' else 'Partenaire' end;
  if not public.est_admin() then new.partage_partenaire:=false;new.partage_client:=new.auteur_role='Client';new.obligatoire:=false;end if;
 else
  if not public.est_admin() then raise exception 'Modification réservée à HelixCar'; end if;
  if (new.id,new.client_id,new.chemin,new.auteur,new.auteur_role,new.created_at,new.categorie) is distinct from (old.id,old.client_id,old.chemin,old.auteur,old.auteur_role,old.created_at,old.categorie) then raise exception 'Origine du document immuable';end if;
 end if;
 return new;
end $$;
revoke all on function private.garder_piece_mission() from public,anon,authenticated;
create trigger garder_piece before insert or update on public.pieces_mission for each row execute function private.garder_piece_mission();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pieces-missions','pieces-missions',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy pieces_storage_insert on storage.objects for insert to authenticated with check(bucket_id='pieces-missions' and (storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.clients c where c.id::text=(storage.foldername(name))[1] and private.acces_dossier_piece(c.id,null,false)));
-- Le partenaire dépose uniquement sur un dossier où une mission lui est attribuée.
create policy pieces_storage_partenaire on storage.objects for insert to authenticated with check(bucket_id='pieces-missions' and (storage.foldername(name))[2]=auth.uid()::text and exists(select 1 from public.missions m join public.convoyeurs p on p.id=m.convoyeur_id where m.client_id::text=(storage.foldername(name))[1] and p.auth_user_id=auth.uid() and public.partenaire_actif()));
create policy pieces_storage_read on storage.objects for select to authenticated using(bucket_id='pieces-missions' and exists(select 1 from public.pieces_mission d where d.chemin=name));
create policy pieces_storage_cleanup on storage.objects for delete to authenticated using(bucket_id='pieces-missions' and (storage.foldername(name))[2]=auth.uid()::text and not exists(select 1 from public.pieces_mission d where d.chemin=name));

-- Liste minimale pour les dépôts clients, sans exposer la table Missions.
create function private.contextes_documents() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
 select m.id mission_id,m.client_id,coalesce(m.reference_courte,m.reference) reference,m.type_mission
 from public.missions m where auth.uid() is not null and (public.est_admin() or exists(select 1 from public.clients c where c.id=m.client_id and c.auth_user_id=auth.uid()) or (m.convoyeur_id=public.convoyeur_de_session() and public.partenaire_actif()))
 union all select null,c.id,'Demande · '||coalesce(c.prenom,'')||' '||coalesce(c.nom,'')||' · '||to_char(c.created_at,'DD/MM/YYYY'),'demande' from public.clients c where auth.uid() is not null and (public.est_admin() or c.auth_user_id=auth.uid())
 ) x
$$;
create function public.contextes_documents() returns jsonb language sql security invoker set search_path='' as $$select private.contextes_documents()$$;
revoke all on function private.contextes_documents(),public.contextes_documents() from public,anon;
grant execute on function private.contextes_documents(),public.contextes_documents() to authenticated;

create function private.controler_fin_mission(mid uuid,decision text,commentaire text default null) returns void language plpgsql security definer set search_path='' as $$
declare m public.missions%rowtype; phases text[]; ids uuid[];
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Administration requise';end if;
 select * into m from public.missions where id=mid for update;
 if not found or m.convoyeur_id is null or m.statut not in ('edl_termine','fini','terminee') then raise exception 'Réalisation non terminée ou partenaire absent';end if;
 if m.validee_paiement then raise exception 'Mission déjà validée pour facturation';end if;
 if decision not in ('validee','a_corriger') or decision is null then raise exception 'Décision invalide';end if;
 if decision='a_corriger' and length(trim(coalesce(commentaire,'')))<3 then raise exception 'Précisez la correction attendue';end if;
 if decision='validee' then
  if coalesce(m.type_mission,'convoyage')='convoyage' then
   if nullif(trim(m.lettre_voiture_signee_url),'') is null then raise exception 'Lettre de voiture signée manquante';end if;
   phases:=case when m.restitution then array['depart','arrivee','restitution_depart','restitution_arrivee'] else array['depart','arrivee'] end;
   if exists(select 1 from unnest(phases) p where not exists(select 1 from public.etats_des_lieux e where e.mission_id=mid and e.phase=p and nullif(e.signature_url,'') is not null and e.vehicule_source_id is not distinct from m.vehicule_source_id)) then raise exception 'États des lieux signés incomplets';end if;
  end if;
  if exists(select 1 from public.pieces_mission where mission_id=mid and obligatoire and etat='a_corriger' and (categorie<>'lettre_signee' or 'pieces-missions/'||chemin=m.lettre_voiture_signee_url)) then raise exception 'Un document obligatoire reste à corriger';end if;
  if m.remuneration_prevue is null or m.remuneration_prevue<=0 then raise exception 'Rémunération à vérifier';end if;
 end if;
 select array_agg(id) into ids from public.etats_des_lieux where mission_id=mid;
 insert into public.controles_fin_mission(mission_id,decision,commentaire,lettre_url,edl_ids) values(mid,decision,nullif(trim(commentaire),''),m.lettre_voiture_signee_url,coalesce(ids,'{}'));
 if decision='validee' then
  if m.statut='edl_termine' then update public.missions set statut='fini' where id=mid;end if;
  update public.missions set statut='terminee',validee_paiement=true,date_validation_paiement=now(),prestation_validee_le=now() where id=mid;
  update public.pieces_mission set etat='valide' where mission_id=mid and obligatoire and etat='recu';
 end if;
end $$;
create function public.controler_fin_mission(mid uuid,decision text,commentaire text default null) returns void language sql security invoker set search_path='' as $$select private.controler_fin_mission(mid,decision,commentaire)$$;
revoke all on function private.controler_fin_mission(uuid,text,text),public.controler_fin_mission(uuid,text,text) from public,anon;
grant execute on function private.controler_fin_mission(uuid,text,text),public.controler_fin_mission(uuid,text,text) to authenticated;
create function private.garder_validation_finale() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.validee_paiement and not coalesce(old.validee_paiement,false) and auth.uid() is not null then
  if not public.est_admin() or not exists(select 1 from public.controles_fin_mission c where c.mission_id=new.id and c.decision='validee' and c.auteur=auth.uid() and c.created_at=now()) then raise exception 'Utilisez le contrôle final de la mission';end if;
 end if;
 if coalesce(old.validee_paiement,false) and (new.statut,new.convoyeur_id,new.remuneration_prevue,new.lettre_voiture_signee_url,new.validee_paiement) is distinct from (old.statut,old.convoyeur_id,old.remuneration_prevue,old.lettre_voiture_signee_url,old.validee_paiement) then raise exception 'Mission validée pour facturation : données verrouillées';end if;
 return new;
end $$;
revoke all on function private.garder_validation_finale() from public,anon,authenticated;
create trigger garde_validation_finale before update on public.missions for each row execute function private.garder_validation_finale();

alter table public.factures_convoyeur add column correction_commentaire text;
create function private.jours_ouvres_apres(d timestamptz,n integer) returns timestamptz language plpgsql immutable set search_path='' as $$
declare r timestamp:=d at time zone 'Europe/Paris'; i integer:=0;
begin while i<n loop r:=r+interval '1 day';if extract(isodow from r)<6 then i:=i+1;end if;end loop;return r at time zone 'Europe/Paris';end $$;
revoke all on function private.jours_ouvres_apres(timestamptz,integer) from public,anon,authenticated;
create function private.garder_facturation() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.missions%rowtype; mid uuid; total numeric:=0; precedent timestamptz;
begin
 if auth.uid() is null then raise exception 'Session requise';end if;
 if tg_op='INSERT' then
  if not public.est_proprietaire_convoyeur(new.convoyeur_id) or not public.partenaire_actif() then raise exception 'Partenaire non autorisé';end if;
  perform 1 from public.convoyeurs where id=new.convoyeur_id for update;
  if jsonb_typeof(new.mission_ids) is distinct from 'array' or jsonb_array_length(new.mission_ids)=0 then raise exception 'Sélectionnez une mission';end if;
  if jsonb_array_length(new.mission_ids)<>(select count(distinct value) from jsonb_array_elements_text(new.mission_ids)) then raise exception 'Mission sélectionnée deux fois';end if;
  for mid in select value::uuid from jsonb_array_elements_text(new.mission_ids) order by value loop
   select * into m from public.missions where id=mid for update;
   if not found or m.convoyeur_id is distinct from new.convoyeur_id or m.statut<>'terminee' or not coalesce(m.validee_paiement,false) then raise exception 'Mission non validée ou non attribuée au partenaire';end if;
   if coalesce(m.type_mission,'convoyage')='convoyage' and nullif(trim(m.lettre_voiture_signee_url),'') is null then raise exception 'Lettre signée manquante';end if;
   if m.remuneration_prevue is null or m.remuneration_prevue<=0 then raise exception 'Rémunération à vérifier';end if;
   if exists(select 1 from public.factures_convoyeur f where f.mission_ids @> jsonb_build_array(mid::text)) then raise exception 'Mission déjà facturée';end if;
   total:=total+round(m.remuneration_prevue,2);
  end loop;
  select max(date_generation) into precedent from public.factures_convoyeur where convoyeur_id=new.convoyeur_id;
  if precedent is not null and now()<private.jours_ouvres_apres(precedent,5) then raise exception 'Délai de cinq jours ouvrés entre deux factures';end if;
  new.reference:='FAC-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(new.id::text,'-',''),1,12));
  new.montant_total:=total;new.statut:='en_attente';new.date_generation:=now();new.date_validation:=null;new.date_paiement_prevue:=null;new.date_paiement:=null;new.correction_commentaire:=null;
 else
  if (new.id,new.reference,new.convoyeur_id,new.mission_ids,new.montant_total,new.date_generation) is distinct from (old.id,old.reference,old.convoyeur_id,old.mission_ids,old.montant_total,old.date_generation) then raise exception 'Contenu de facturation immuable';end if;
  if public.est_admin() then
   if old.statut='en_attente' and new.statut='validee' then new.date_validation:=now();new.date_paiement_prevue:=private.jours_ouvres_apres(now(),9);new.date_paiement:=null;
   elsif old.statut='en_attente' and new.statut='a_corriger' and length(trim(coalesce(new.correction_commentaire,'')))>=3 then new.date_validation:=null;new.date_paiement_prevue:=null;new.date_paiement:=null;
   elsif old.statut='validee' and new.statut='payee' then new.date_paiement:=now();new.date_validation:=old.date_validation;new.date_paiement_prevue:=old.date_paiement_prevue;
   else raise exception 'Transition de facturation non autorisée';end if;
  elsif public.est_proprietaire_convoyeur(old.convoyeur_id) and public.partenaire_actif() and old.statut='a_corriger' and new.statut='en_attente' then
   new.date_validation:=null;new.date_paiement_prevue:=null;new.date_paiement:=null;new.correction_commentaire:=old.correction_commentaire;
  else raise exception 'Action de facturation non autorisée';end if;
 end if;return new;
end $$;
revoke all on function private.garder_facturation() from public,anon,authenticated;
create trigger garde_facturation before insert or update on public.factures_convoyeur for each row execute function private.garder_facturation();
create policy facture_retour_partenaire on public.factures_convoyeur for update to authenticated using(public.est_proprietaire_convoyeur(convoyeur_id) and statut='a_corriger') with check(public.est_proprietaire_convoyeur(convoyeur_id) and statut='en_attente');
create trigger hc_sync_change after insert or update on public.pieces_mission for each row execute function private.hc_signaler_modification();
create trigger hc_sync_change after insert on public.controles_fin_mission for each row execute function private.hc_signaler_modification();
-- Lettres signées déposées dans le même stockage privé, sans URL publique permanente.
alter table public.pieces_mission add column categorie text not null default 'document' check(categorie in ('document','lettre_signee'));
alter table public.pieces_mission drop constraint pieces_mission_etat_check;
alter table public.pieces_mission add constraint pieces_mission_etat_check check(etat in ('recu','valide','a_corriger','remplace'));
create function private.rattacher_lettre_privee() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.missions%rowtype;
begin
 if new.categorie<>'lettre_signee' then return new;end if;
 select * into m from public.missions where id=new.mission_id for update;
 if not found or coalesce(m.type_mission,'convoyage')<>'convoyage' or m.statut not in ('edl_termine','fini') or m.validee_paiement then raise exception 'La lettre signée se dépose après les états des lieux et avant validation finale';end if;
 if not public.est_admin() and not (m.convoyeur_id=public.convoyeur_de_session() and public.partenaire_actif()) then raise exception 'Lettre réservée au partenaire affecté ou à HelixCar';end if;
 update public.missions set lettre_voiture_signee_url='pieces-missions/'||new.chemin,lettre_voiture_signee_date=now(),statut='fini' where id=m.id;
 return new;
end $$;
revoke all on function private.rattacher_lettre_privee() from public,anon,authenticated;
create trigger rattacher_lettre after insert on public.pieces_mission for each row execute function private.rattacher_lettre_privee();
