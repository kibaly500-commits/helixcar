-- EDL atomique pour les missions préparées comme pour les anciens devis.
-- Les offres disponibles sont filtrées à la source, indépendamment du cache UI.
create or replace view public.v_opportunites_partenaire as
SELECT o.id,
    o.statut,
    o.intitule,
    o.categorie,
    o.date_debut,
    o.date_fin,
    o.duree_texte,
    o.zone_generale,
    o.ponctuelle,
    o.statut_independant,
    o.badges_requis,
    o.nb_professionnels,
    o.description_publique,
    o.publiee_le,
        CASE
            WHEN ca.etat = 'preselectionne'::text THEN 'a_etudier'::text
            ELSE ca.etat
        END AS ma_candidature_etat,
    ca.created_at AS ma_candidature_le,
    m.devis_source_id IS NOT NULL AND m.preparation_id IS NULL AS acceptation_directe,
        CASE
            WHEN m.devis_source_id IS NOT NULL THEN m.remuneration_prevue
            ELSE NULL::numeric
        END AS remuneration_prevue,
        CASE
            WHEN m.devis_source_id IS NOT NULL THEN m.date_prise_en_charge
            ELSE NULL::timestamp without time zone
        END AS depart_prevu,
        CASE
            WHEN m.devis_source_id IS NOT NULL THEN m.date_livraison
            ELSE NULL::timestamp without time zone
        END AS livraison_prevue,
        CASE
            WHEN m.devis_source_id IS NOT NULL THEN m.restitution
            ELSE NULL::boolean
        END AS restitution_prevue,
        CASE
            WHEN m.devis_source_id IS NOT NULL THEN m.plateau
            ELSE NULL::boolean
        END AS transport_plateau,
    p.annonce AS preparation_annonce,
        CASE
            WHEN ca.etat = 'retenu'::text THEN m.id
            ELSE NULL::uuid
        END AS mission_id
   FROM opportunites o
     JOIN missions m ON m.id = o.mission_id
     LEFT JOIN preparations_missions p ON p.id = m.preparation_id
     LEFT JOIN opportunite_candidatures ca ON ca.opportunite_id = o.id AND ca.convoyeur_id = convoyeur_de_session()
  WHERE partenaire_actif() AND o.statut <> 'brouillon'::text AND (o.statut = 'a_pourvoir'::text OR ca.id IS NOT NULL) AND o.badges_requis && activites_validees_partenaire() AND (m.devis_source_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM paiement_evenements e
          WHERE e.devis_id = p.devis_id AND (e.detail ->> 'livemode'::text) = 'false'::text)) OR (EXISTS ( SELECT 1
           FROM convoyeurs c
          WHERE c.id = convoyeur_de_session() AND (lower(c.email) = ANY (ARRAY['kibaly500@gmail.com'::text, 'kibaly500+qa-final01@gmail.com'::text])))) AND (m.convoyeur_id IS NULL OR m.convoyeur_id = convoyeur_de_session())) AND (o.categorie = ANY (activites_validees_partenaire())) AND badge_autorise_mission(o.mission_id)
 AND o.statut='a_pourvoir'
 AND m.convoyeur_id IS DISTINCT FROM public.convoyeur_de_session()
 AND (coalesce(o.date_fin,o.date_debut) IS NULL OR coalesce(o.date_fin,o.date_debut)>=(now() at time zone 'Europe/Paris')::date);
-- Les horaires planifiés restent immuables ; created_at porte le constat réel.
create or replace function private.enregistrer_edl_mission(p_mission_id uuid,p_phase text,p_submission_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.missions%rowtype; precedent public.etats_des_lieux%rowtype; attendu text; cible text; fichier text; slot text; v_km integer; eid uuid; prefixe text; ancien text;
begin
 select * into m from public.missions where id=p_mission_id for update;
 if not found or coalesce(m.type_mission,'convoyage')<>'convoyage' or auth.uid() is null or not public.partenaire_actif()
 or not exists(select 1 from public.convoyeurs c where c.id=m.convoyeur_id and c.auth_user_id=auth.uid()) then
 return jsonb_build_object('ok',false,'code','NON_AUTORISE'); end if;
 if p_submission_id is null or p_payload is null or p_phase not in ('depart','arrivee','restitution_depart','restitution_arrivee') or p_phase is null then
 return jsonb_build_object('ok',false,'code','DONNEES_INVALIDES'); end if;
 if p_phase in ('restitution_depart','restitution_arrivee') and not coalesce(m.restitution,false) then return jsonb_build_object('ok',false,'code','ORDRE_INVALIDE'); end if;
 select * into precedent from public.etats_des_lieux where mission_id=m.id and phase=p_phase;
 if found then
   return jsonb_build_object('ok',coalesce(precedent.submission_id=p_submission_id,false),'code',case when precedent.submission_id=p_submission_id then 'DEJA_ENREGISTRE' else 'PHASE_DEJA_VALIDEE' end,'id',precedent.id);
 end if;
 attendu:=case p_phase when 'depart' then 'acceptee' when 'arrivee' then 'en_cours' when 'restitution_depart' then 'restitution_requise' else 'restitution_en_cours' end;
 cible:=case p_phase when 'depart' then 'en_cours' when 'arrivee' then case when m.restitution then 'restitution_requise' else 'edl_termine' end when 'restitution_depart' then 'restitution_en_cours' else 'edl_termine' end;
 if m.statut<>attendu then return jsonb_build_object('ok',false,'code','ORDRE_INVALIDE'); end if;
 if coalesce(p_payload->>'km','')!~'^[0-9]+$' or length(p_payload->>'km')>9 or nullif(p_payload->>'carburant','') is null
 or coalesce(p_payload->>'etat_general','') not in ('mauvais','acceptable','bon','excellent') then return jsonb_build_object('ok',false,'code','DONNEES_INVALIDES'); end if;
 v_km:=(p_payload->>'km')::integer;
 if p_phase in ('arrivee','restitution_arrivee') and exists(select 1 from public.etats_des_lieux e where e.mission_id=m.id and e.phase=case p_phase when 'arrivee' then 'depart' else 'restitution_depart' end and e.km>v_km) then
 return jsonb_build_object('ok',false,'code','KILOMETRAGE_INCOHERENT'); end if;
 prefixe:=m.id::text||'/'||p_phase||'/'||p_submission_id::text||'/';
 if jsonb_typeof(p_payload->'photos') is distinct from 'object' then return jsonb_build_object('ok',false,'code','PHOTOS_MANQUANTES'); end if;
 foreach slot in array array['vin','avant','arriere','gauche','droit','avg','avd','arg','ard','pag','pad','prg','prd','tenue','parebrise','hab-av','hab-ar','tableau','coffre'] loop
   if nullif(p_payload->'photos'->>slot,'') is null then return jsonb_build_object('ok',false,'code','PHOTOS_MANQUANTES','slot',slot); end if;
 end loop;
 for fichier in select value from jsonb_each_text(p_payload->'photos') union all select p_payload->>'signature_url' loop
   if fichier is null or left(fichier,length('edl-test/'||prefixe))<>'edl-test/'||prefixe
      or not exists(select 1 from storage.objects where bucket_id='edl-test' and name=substring(fichier from 10)) then
     return jsonb_build_object('ok',false,'code','FICHIER_NON_ENREGISTRE');
   end if;
 end loop;
 ancien:=current_setting('hc.validation_edl_test',true);
 perform set_config('hc.validation_edl_test','1',true);
 insert into public.etats_des_lieux(mission_id,phase,submission_id,vehicule_source_id,km,carburant,etat_general,observations,dommages,signature_url,photos)
 values(m.id,p_phase,p_submission_id,m.vehicule_source_id,v_km,p_payload->>'carburant',p_payload->>'etat_general',left(p_payload->>'observations',10000),left(p_payload->>'dommages',10000),p_payload->>'signature_url',p_payload->'photos') returning id into eid;
 update public.missions set statut=cible where id=m.id;
 perform set_config('hc.validation_edl_test',coalesce(ancien,''),true);
 return jsonb_build_object('ok',true,'code','ENREGISTRE','id',eid,'statut',cible);
end $$;
revoke all on function private.enregistrer_edl_mission(uuid,text,uuid,jsonb) from public,anon;
grant execute on function private.enregistrer_edl_mission(uuid,text,uuid,jsonb) to authenticated;


-- Compatibilité de l’API existante ; la logique privilégiée reste dans private.
create or replace function public.enregistrer_edl_test(p_mission_id uuid,p_phase text,p_submission_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.enregistrer_edl_mission(p_mission_id,p_phase,p_submission_id,p_payload);
$$;
revoke all on function public.enregistrer_edl_test(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.enregistrer_edl_test(uuid,text,uuid,jsonb) to authenticated;

-- Toutes les missions de convoyage utilisent le même stockage privé.
create or replace function public.acces_fichier_edl_test(p_path text,p_ecriture boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare mid uuid;
begin
 if auth.uid() is null then return false; end if;
 begin mid:=split_part(p_path,'/',1)::uuid; exception when invalid_text_representation then return false; end;
 return exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id
 where m.id=mid and coalesce(m.type_mission,'convoyage')='convoyage' and
 (case when p_ecriture then c.auth_user_id=auth.uid() and public.partenaire_actif()
 else public.est_admin() or c.auth_user_id=auth.uid() or cl.auth_user_id=auth.uid() end));
end $$;
revoke all on function public.acces_fichier_edl_test(text,boolean) from public,anon;
grant execute on function public.acces_fichier_edl_test(text,boolean) to authenticated;

-- Un ancien navigateur ne doit plus pouvoir créer un rapport isolé du statut.
create or replace function public.garder_edl_test() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' or coalesce(current_setting('hc.validation_edl_test',true),'')<>'1' then
   raise exception 'EDL signé : utiliser la validation serveur' using errcode='42501';
 end if;
 new.created_at:=now();
 return new;
end $$;
revoke all on function public.garder_edl_test() from public,anon,authenticated;

create or replace function public.garder_etapes_mission_test() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_requise text;
begin
 if coalesce(new.type_mission,'convoyage')<>'convoyage' or new.statut=old.statut then return new; end if;
 phase_requise:=case new.statut when 'en_cours' then 'depart' when 'restitution_requise' then 'arrivee'
 when 'restitution_en_cours' then 'restitution_depart' when 'edl_termine' then case when new.restitution then 'restitution_arrivee' else 'arrivee' end
 when 'fini' then case when new.restitution then 'restitution_arrivee' else 'arrivee' end
 when 'terminee' then case when new.restitution then 'restitution_arrivee' else 'arrivee' end end;
 if phase_requise is not null and not exists(select 1 from public.etats_des_lieux where mission_id=new.id and phase=phase_requise and vehicule_source_id is not distinct from new.vehicule_source_id) then
 raise exception 'État des lieux signé manquant : %',phase_requise; end if;
 if new.statut='terminee' and (old.statut<>'fini' or (auth.uid() is not null and not public.est_admin())) then
 raise exception 'Clôture réservée à HelixCar après livraison'; end if;
 return new;
end $$;
revoke all on function public.garder_etapes_mission_test() from public,anon,authenticated;
