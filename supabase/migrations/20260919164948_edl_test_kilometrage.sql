-- Lever l ambiguite entre la colonne km et la variable du rapport courant.
create or replace function public.enregistrer_edl_test(p_mission_id uuid,p_phase text,p_submission_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.missions%rowtype; precedent public.etats_des_lieux%rowtype; attendu text; cible text; fichier text; slot text; v_km integer; eid uuid; prefixe text; ancien text;
begin
 select * into m from public.missions where id=p_mission_id for update;
 if not found or m.devis_source_id is null or auth.uid() is null or not public.partenaire_actif()
 or not exists(select 1 from public.convoyeurs c where c.id=m.convoyeur_id and c.auth_user_id=auth.uid()) then
 return jsonb_build_object('ok',false,'code','NON_AUTORISE'); end if;
 if p_submission_id is null or p_payload is null or p_phase not in ('depart','arrivee','restitution_depart','restitution_arrivee') or p_phase is null then
 return jsonb_build_object('ok',false,'code','DONNEES_INVALIDES'); end if;
 select * into precedent from public.etats_des_lieux where mission_id=m.id and phase=p_phase and vehicule_source_id=m.vehicule_source_id;
 if found then
   return jsonb_build_object('ok',precedent.submission_id=p_submission_id,'code',case when precedent.submission_id=p_submission_id then 'DEJA_ENREGISTRE' else 'PHASE_DEJA_VALIDEE' end,'id',precedent.id);
 end if;
 attendu:=case p_phase when 'depart' then 'acceptee' when 'arrivee' then 'en_cours' when 'restitution_depart' then 'restitution_requise' else 'restitution_en_cours' end;
 cible:=case p_phase when 'depart' then 'en_cours' when 'arrivee' then case when m.restitution then 'restitution_requise' else 'edl_termine' end when 'restitution_depart' then 'restitution_en_cours' else 'edl_termine' end;
 if m.statut<>attendu then return jsonb_build_object('ok',false,'code','ORDRE_INVALIDE'); end if;
 if coalesce(p_payload->>'km','')!~'^\d+$' or length(p_payload->>'km')>9 or nullif(p_payload->>'carburant','') is null
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
revoke all on function public.enregistrer_edl_test(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.enregistrer_edl_test(uuid,text,uuid,jsonb) to authenticated;

