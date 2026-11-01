-- Exception figée pour les comptes de recette déjà présents, non modifiable par le navigateur.
create table private.partenaires_sans_portrait_recette(partenaire_id uuid primary key references public.convoyeurs(id) on delete cascade);
alter table private.partenaires_sans_portrait_recette enable row level security;
revoke all on private.partenaires_sans_portrait_recette from public,anon,authenticated;
insert into private.partenaires_sans_portrait_recette select id from public.convoyeurs;
create unique index partenaire_portrait_unique on public.convoyeurs(photo_profil_chemin) where photo_profil_chemin is not null;
-- Envoi par le serveur après contrôle du jeton du dossier, sans dépôt anonyme.
create policy portrait_inscription_lecture on storage.objects for select to authenticated using(
 bucket_id='portraits-partenaires' and exists(select 1 from public.convoyeurs c where c.auth_user_id=(select auth.uid()) and c.photo_profil_chemin=objects.name));
create or replace function private.controler_portrait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.photo_profil_chemin is not distinct from old.photo_profil_chemin then return new;end if;
 if tg_op='INSERT' and new.photo_profil_chemin is null and new.statut<>'video_attendue' then raise exception 'Ajoutez votre photo professionnelle pour créer votre compte partenaire.' using errcode='23514';end if;
 if new.photo_profil_chemin is not null then
  if not exists(select 1 from storage.objects where bucket_id='portraits-partenaires' and name=new.photo_profil_chemin and metadata->>'mimetype' in ('image/jpeg','image/png')) then raise exception 'Photo de profil non autorisée';end if;
  if new.photo_profil_chemin ~ '^inscription/[0-9a-f-]{36}\.(jpg|png)$' and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' then return new;end if;
  if new.auth_user_id is null or split_part(new.photo_profil_chemin,'/',1)<>new.auth_user_id::text then raise exception 'Photo de profil non autorisée';end if;
 end if;
 return new;
end $$;
create or replace function private.exiger_portrait_candidature() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.partenaires_sans_portrait_recette where partenaire_id=new.convoyeur_id) then return new;end if;
 if not exists(select 1 from public.convoyeurs c join storage.objects s on s.bucket_id='portraits-partenaires' and s.name=c.photo_profil_chemin where c.id=new.convoyeur_id) then
 raise exception 'Ajoutez votre photo de profil professionnelle dans Mon profil avant de postuler.' using errcode='23514';end if;
 return new;
end $$;

create function private.exiger_portrait_inscription_finale() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.statut in ('en_attente','actif') and not exists(select 1 from private.partenaires_sans_portrait_recette where partenaire_id=new.id) and
 not exists(select 1 from storage.objects where bucket_id='portraits-partenaires' and name=new.photo_profil_chemin) then
 raise exception 'Ajoutez votre photo professionnelle pour finaliser votre inscription.' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.exiger_portrait_inscription_finale() from public,anon,authenticated;
create trigger exiger_portrait_inscription_finale before insert or update of statut on public.convoyeurs for each row execute function private.exiger_portrait_inscription_finale();
