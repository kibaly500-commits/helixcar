-- V01 : démarrage verrouillé, objet final immuable et mesures du worker.
-- Migration additive, aucun objet ni candidature existante supprimé.
begin;
create table if not exists public.video_verifications (
  chemin_source text primary key,
  convoyeur_id uuid not null references public.convoyeurs(id),
  chemin_final text not null unique,
  etat text not null default 'en_attente' check(etat in ('en_attente','verifie','refuse')),
  taille_octets bigint,
  duree_secondes numeric,
  mime text,
  codec text,
  sha256 text,
  code_refus text,
  created_at timestamptz not null default now(),
  verifie_le timestamptz,
  check(etat <> 'verifie' or (taille_octets is not null and duree_secondes is not null and mime is not null and sha256 is not null and taille_octets between 1 and 314572800 and duree_secondes > 0
    and duree_secondes <= 120 and mime in ('video/mp4','video/quicktime','video/webm')
    and codec is not null and sha256 ~ '^[0-9a-f]{64}$' and verifie_le is not null))
);
alter table public.video_verifications enable row level security;
revoke all on public.video_verifications from public,anon,authenticated;
grant select,insert,update on public.video_verifications to service_role;

create or replace function public.preparer_video_candidature(p_id uuid,p_mime text,p_taille bigint,p_duree numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.convoyeurs%rowtype; v_ext text; v_max integer; v_chemin text; v_reprise boolean;
begin
 select * into c from public.convoyeurs where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'code','INTROUVABLE'); end if;
 if c.video_envoyee_le is not null then return jsonb_build_object('ok',true,'deja_confirmee',true,'chemin',c.video_chemin); end if;
 v_ext:=case p_mime when 'video/mp4' then '.mp4' when 'video/quicktime' then '.mov' when 'video/webm' then '.webm' end;
 v_max:=case when c.activites && array['renfort','technicien']::text[] then 120 when 'convoyage'=any(c.activites) then 60 else 0 end;
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
 v_max:=case when c.activites && array['renfort','technicien']::text[] then 120 when 'convoyage'=any(c.activites) then 60 else 0 end;
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
-- L'ancien point d'entrée ne doit pas contourner le contrôle des mesures.
revoke all on function public.finaliser_video_candidature(uuid,bigint) from public,anon,authenticated,service_role;

-- Toutes les écritures Storage vidéo passent par les autorisations serveur.
-- Le propriétaire conserve sa lecture privée ; il ne peut remplacer ou
-- supprimer l'objet validé par un appel direct à Storage.
drop policy if exists "candidature video : depot par le proprietaire authentifie" on storage.objects;
drop policy if exists "candidature video : remplacement par le proprietaire" on storage.objects;
drop policy if exists "candidature video : suppression par le proprietaire" on storage.objects;
create or replace function public.garde_video_finale_serveur()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is not null then
   if tg_op='INSERT' then
     if new.video_chemin is not null or new.video_envoyee_le is not null or new.video_envoi_chemin is not null then
       raise exception 'La vidéo est finalisée par le serveur.' using errcode='42501'; end if;
   elsif new.video_chemin is distinct from old.video_chemin or new.video_envoyee_le is distinct from old.video_envoyee_le
      or new.video_mime is distinct from old.video_mime or new.video_taille_octets is distinct from old.video_taille_octets
      or new.video_duree_secondes is distinct from old.video_duree_secondes or new.video_envoi_chemin is distinct from old.video_envoi_chemin then
     raise exception 'La vidéo est finalisée par le serveur.' using errcode='42501';
   end if;
 end if;
 return new;
end $$;
revoke all on function public.garde_video_finale_serveur() from public;
drop trigger if exists trg_video_finale_serveur on public.convoyeurs;
create trigger trg_video_finale_serveur before insert or update on public.convoyeurs for each row execute function public.garde_video_finale_serveur();
commit;
