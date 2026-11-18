-- HelixCar — 120 : RIB demandé après validation, stockage privé
-- Dépend de 90 et 105. Additive et idempotente.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'convoyeurs-documents', 'convoyeurs-documents', false, 10485760,
       array['application/pdf', 'image/jpeg', 'image/png']
where not exists (select 1 from storage.buckets where id = 'convoyeurs-documents');

update storage.buckets
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
 where id = 'convoyeurs-documents';

-- Une candidature publique ne peut jamais préremplir cette colonne :
-- le RIB n'entre dans le parcours qu'après validation et connexion.
drop policy if exists "convoyeurs : depot de candidature" on public.convoyeurs;
create policy "convoyeurs : depot de candidature"
  on public.convoyeurs for insert to anon, authenticated
  with check (rib_iban is null);

-- Le premier segment du chemin est l'UUID du partenaire, le deuxième
-- est toujours "rib". Aucun accès anonyme et aucune URL publique.
drop policy if exists "rib partenaire : lecture proprietaire admin" on storage.objects;
create policy "rib partenaire : lecture proprietaire admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'convoyeurs-documents'
    and (
      (select public.est_admin())
      or exists (
        select 1 from public.convoyeurs c
         where c.id::text = (storage.foldername(name))[1]
           and (storage.foldername(name))[2] = 'rib'
           and c.auth_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "rib partenaire : depot proprietaire actif" on storage.objects;
create policy "rib partenaire : depot proprietaire actif"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'convoyeurs-documents'
    and (storage.foldername(name))[2] = 'rib'
    and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png')
    and exists (
      select 1 from public.convoyeurs c
       where c.id::text = (storage.foldername(name))[1]
         and c.auth_user_id = (select auth.uid())
         and c.statut = 'actif' and c.bloque is false
    )
  );

drop policy if exists "rib partenaire : remplacement proprietaire actif" on storage.objects;
create policy "rib partenaire : remplacement proprietaire actif"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'convoyeurs-documents'
    and exists (
      select 1 from public.convoyeurs c
       where c.id::text = (storage.foldername(name))[1]
         and c.auth_user_id = (select auth.uid())
         and c.statut = 'actif' and c.bloque is false
    )
  )
  with check (
    bucket_id = 'convoyeurs-documents'
    and (storage.foldername(name))[2] = 'rib'
    and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png')
    and exists (
      select 1 from public.convoyeurs c
       where c.id::text = (storage.foldername(name))[1]
         and c.auth_user_id = (select auth.uid())
         and c.statut = 'actif' and c.bloque is false
    )
  );

drop policy if exists "rib partenaire : suppression proprietaire admin" on storage.objects;
create policy "rib partenaire : suppression proprietaire admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'convoyeurs-documents'
    and (
      (select public.est_admin())
      or exists (
        select 1 from public.convoyeurs c
         where c.id::text = (storage.foldername(name))[1]
           and (storage.foldername(name))[2] = 'rib'
           and c.auth_user_id = (select auth.uid())
           and c.statut = 'actif' and c.bloque is false
      )
    )
  );

-- Complète le garde-fou de 105 : seul le propriétaire actif peut
-- rattacher un fichier RIB qu'il vient réellement de déposer dans son
-- dossier. Les champs de décision et de vidéo restent réservés au serveur.
create or replace function public.garde_colonnes_sensibles_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return new; end if;
  if public.est_admin() then return new; end if;

  if new.bloque is distinct from old.bloque
     or new.bloque_le is distinct from old.bloque_le
     or new.bloque_par is distinct from old.bloque_par
     or new.bloque_motif is distinct from old.bloque_motif
     or new.statut is distinct from old.statut then
    raise exception 'Modification réservée à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.video_chemin is distinct from old.video_chemin
     or new.video_mime is distinct from old.video_mime
     or new.video_taille_octets is distinct from old.video_taille_octets
     or new.video_duree_secondes is distinct from old.video_duree_secondes
     or new.video_envoyee_le is distinct from old.video_envoyee_le
     or new.video_envoi_chemin is distinct from old.video_envoi_chemin
     or new.video_envoi_mime is distinct from old.video_envoi_mime
     or new.video_envoi_taille_octets is distinct from old.video_envoi_taille_octets
     or new.video_envoi_duree_secondes is distinct from old.video_envoi_duree_secondes
     or new.video_envoi_commence_le is distinct from old.video_envoi_commence_le
     or new.video_upload_jeton_hash is distinct from old.video_upload_jeton_hash
     or new.video_upload_jeton_consomme_le is distinct from old.video_upload_jeton_consomme_le then
    raise exception 'La vidéo de candidature est gérée par le serveur.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.rib_iban is distinct from old.rib_iban then
    if old.auth_user_id is distinct from auth.uid()
       or old.statut <> 'actif' or old.bloque is true
       or new.rib_iban is null
       or new.rib_iban !~ ('^' || old.id::text || '/rib/[0-9a-f-]{16,}\\.(pdf|jpg|jpeg|png)$')
       or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'convoyeurs-documents'
            and o.name = new.rib_iban
            and o.owner_id = auth.uid()::text
       ) then
      raise exception 'RIB invalide ou non autorisé.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_garde_colonnes_sensibles_convoyeur on public.convoyeurs;
create trigger trg_garde_colonnes_sensibles_convoyeur
  before update on public.convoyeurs
  for each row execute function public.garde_colonnes_sensibles_convoyeur();

revoke all on function public.garde_colonnes_sensibles_convoyeur() from public, anon, authenticated;

commit;

-- Contrôles après application :
-- select id, public, file_size_limit from storage.buckets where id='convoyeurs-documents';
-- attendu : public=false, file_size_limit=10485760
