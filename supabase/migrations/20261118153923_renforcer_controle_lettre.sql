-- Une lettre refusée bloque la validation ; la validation finale contrôle la version courante.
create or replace function private.controler_fin_mission(mid uuid,decision text,commentaire text default null) returns void language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from public.pieces_mission where mission_id=mid and (obligatoire or categorie='lettre_signee') and etat='a_corriger' and (categorie<>'lettre_signee' or 'pieces-missions/'||chemin=m.lettre_voiture_signee_url)) then raise exception 'Un document obligatoire reste à corriger';end if;
  if m.remuneration_prevue is null or m.remuneration_prevue<=0 then raise exception 'Rémunération à vérifier';end if;
 end if;
 select array_agg(id) into ids from public.etats_des_lieux where mission_id=mid;
 insert into public.controles_fin_mission(mission_id,decision,commentaire,lettre_url,edl_ids) values(mid,decision,nullif(trim(commentaire),''),m.lettre_voiture_signee_url,coalesce(ids,'{}'));
 if decision='validee' then
  if m.statut='edl_termine' then update public.missions set statut='fini' where id=mid;end if;
  update public.missions set statut='terminee',validee_paiement=true,date_validation_paiement=now(),prestation_validee_le=now() where id=mid;
  update public.pieces_mission set etat='valide' where mission_id=mid and (obligatoire or categorie='lettre_signee') and etat='recu' and (categorie<>'lettre_signee' or 'pieces-missions/'||chemin=m.lettre_voiture_signee_url);
 end if;
end $$;
