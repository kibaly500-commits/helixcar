-- HelixCar — 123 : deux minutes de vidéo pour tous les partenaires.
-- Le convoyage rejoint les autres métiers à 120 secondes maximum.
-- Migration additive : aucune candidature ni vidéo n'est supprimée.
begin;

create or replace function public.preparer_video_candidature(p_id uuid,p_mime text,p_taille bigint,p_duree numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.convoyeurs%rowtype; v_ext text; v_max integer; v_chemin text; v_reprise boolean;
begin
 select * into c from public.convoyeurs where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INTROUVABLE'); end if;
 if c.video_envoyee_le is not null then return jsonb_build_object('ok',true,'deja_confirmee',true,'chemin',c.video_chemin); end if;
 v_ext:=case p_mime when 'video/mp4' then '.mp4' when 'video/quicktime' then '.mov' when 'video/webm' then '.webm' end;
 v_max:=case when coalesce(cardinality(c.activites),0)=0 then 0 else 120 end;
 if v_ext is null or p_taille is null or p_taille<1 or p_taille>314572800 or p_duree is null or p_duree<=0 or p_duree>v_max then
   return jsonb_build_object('ok',false,'code','PARAMETRES_INVALIDES'); end if;
 v_reprise:=c.video_envoi_chemin is not null and c.video_envoi_mime=p_mime and c.video_envoi_taille_octets=p_taille
   and c.video_envoi_duree_secondes=p_duree and not exists(select 1 from public.video_verifications where chemin_source=c.video_envoi_chemin and etat='refuse');
 v_chemin:=case when v_reprise then c.video_envoi_chemin else 'candidatures/'||c.id||'/'||gen_random_uuid()||v_ext end;
 update public.convoyeurs set video_envoi_chemin=v_chemin,video_envoi_mime=p_mime,video_envoi_taille_octets=p_taille,
   video_envoi_duree_secondes=p_duree,video_envoi_commence_le=case when v_reprise then c.video_envoi_commence_le else now() end where id=c.id;
 return jsonb_build_object('ok',true,'chemin',v_chemin,'reprise',v_reprise);
end $$;
revoke all on function public.preparer_video_candidature(uuid,text,bigint,numeric) from public,anon,authenticated;
grant execute on function public.preparer_video_candidature(uuid,text,bigint,numeric) to service_role;

create or replace function public.finaliser_video_verifiee(p_id uuid,p_chemin_source text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.convoyeurs%rowtype; v public.video_verifications%rowtype; v_max integer;
begin
 select * into c from public.convoyeurs where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INTROUVABLE'); end if;
 if c.video_envoyee_le is not null then return jsonb_build_object('ok',true,'code','DEJA_FINALISEE','chemin',c.video_chemin,'statut',c.statut); end if;
 if c.video_envoi_chemin is distinct from p_chemin_source then return jsonb_build_object('ok',false,'code','ENVOI_REMPLACE'); end if;
 select * into v from public.video_verifications where chemin_source=p_chemin_source and convoyeur_id=p_id and etat='verifie';
 if not found then return jsonb_build_object('ok',false,'code','VERIFICATION_REQUISE'); end if;
 v_max:=case when coalesce(cardinality(c.activites),0)=0 then 0 else 120 end;
 if v.taille_octets<>c.video_envoi_taille_octets or v.mime<>c.video_envoi_mime or v.duree_secondes>v_max
    or v.chemin_final not like 'candidatures/'||p_id||'/verifie/%' then
   return jsonb_build_object('ok',false,'code','METADONNEES_INCOHERENTES'); end if;
 update public.convoyeurs set video_chemin=v.chemin_final,video_mime=v.mime,video_taille_octets=v.taille_octets,
   video_duree_secondes=v.duree_secondes,video_envoyee_le=now(),
   video_envoi_chemin=null,video_envoi_mime=null,video_envoi_taille_octets=null,video_envoi_duree_secondes=null,video_envoi_commence_le=null,
   video_upload_jeton_consomme_le=coalesce(video_upload_jeton_consomme_le,now()),
   statut=case when statut='video_attendue' then 'en_attente' else statut end where id=p_id returning * into c;
 return jsonb_build_object('ok',true,'code','FINALISEE','chemin',c.video_chemin,'statut',c.statut);
end $$;
revoke all on function public.finaliser_video_verifiee(uuid,text) from public,anon,authenticated;
grant execute on function public.finaliser_video_verifiee(uuid,text) to service_role;

create or replace function public.reclamer_verification_video(p_id uuid,p_jeton_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.video_verifications%rowtype; c public.convoyeurs%rowtype; v_max integer;
begin
  if p_jeton_hash is null or p_jeton_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'code','JETON_INVALIDE');
  end if;
  select * into v from public.video_verifications
   where convoyeur_id=p_id and jeton_worker_hash=p_jeton_hash
     and etat='en_attente' and jeton_worker_consomme_le is null
     and jeton_worker_expire_le>now()
   for update;
  if not found then return jsonb_build_object('ok',false,'code','JETON_INVALIDE'); end if;
  select * into c from public.convoyeurs where id=p_id;
  if not found or c.video_envoi_chemin is distinct from v.chemin_source then
    return jsonb_build_object('ok',false,'code','ENVOI_REMPLACE');
  end if;
  v_max:=case when coalesce(cardinality(c.activites),0)=0 then 0 else 120 end;
  if v_max=0 then return jsonb_build_object('ok',false,'code','VIDEO_NON_ATTENDUE'); end if;
  update public.video_verifications set jeton_worker_consomme_le=now()
   where chemin_source=v.chemin_source;
  return jsonb_build_object('ok',true,'chemin',v.chemin_final,'mime',c.video_envoi_mime,'duree_max',v_max);
end $$;
revoke all on function public.reclamer_verification_video(uuid,text) from public,anon,authenticated;
grant execute on function public.reclamer_verification_video(uuid,text) to service_role;

commit;
