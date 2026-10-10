-- HelixCar — 117 : jeton à usage unique entre l'Edge et le worker vidéo.
-- Le worker n'obtient jamais de service_role. Il échange ce jeton opaque
-- contre une URL de lecture signée courte, une seule fois.
begin;

alter table public.video_verifications
  add column if not exists jeton_worker_hash text,
  add column if not exists jeton_worker_expire_le timestamptz,
  add column if not exists jeton_worker_consomme_le timestamptz;

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
  v_max:=case when c.activites && array['renfort','technicien']::text[] then 120
              when 'convoyage'=any(c.activites) then 60 else 0 end;
  if v_max=0 then return jsonb_build_object('ok',false,'code','VIDEO_NON_ATTENDUE'); end if;
  update public.video_verifications set jeton_worker_consomme_le=now()
   where chemin_source=v.chemin_source;
  return jsonb_build_object('ok',true,'chemin',v.chemin_final,'mime',c.video_envoi_mime,'duree_max',v_max);
end $$;
revoke all on function public.reclamer_verification_video(uuid,text) from public,anon,authenticated;
grant execute on function public.reclamer_verification_video(uuid,text) to service_role;

commit;
