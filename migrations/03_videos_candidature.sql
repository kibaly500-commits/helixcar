-- ============================================================
-- HelixCar — 03 : vidéo de présentation des candidatures partenaires
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- RÈGLE MÉTIER (rappel) : une SEULE vidéo par candidature, quelles que
-- soient les activités choisies. Durée maximale imposée par l'activité
-- la plus exigeante : 1 min (convoyage), 2 min (dès que le renfort est
-- sélectionné), aucune vidéo si seul le nettoyage est retenu.
--
-- SÉCURITÉ : le bucket est PRIVÉ. La base ne stocke QUE le chemin de
-- l'objet et ses métadonnées — jamais une URL publique permanente.
-- La lecture passe obligatoirement par une URL signée temporaire,
-- générée après contrôle d'autorisation.

-- ------------------------------------------------------------
-- 1. Métadonnées de la vidéo, portées par la candidature
-- ------------------------------------------------------------
alter table public.convoyeurs
  add column if not exists video_chemin           text,
  add column if not exists video_mime             text,
  add column if not exists video_taille_octets    bigint,
  add column if not exists video_duree_secondes   numeric(6,2),
  add column if not exists video_envoyee_le       timestamptz;

comment on column public.convoyeurs.video_chemin is
  'Chemin de l''objet dans le bucket privé candidatures-videos. '
  'JAMAIS une URL publique : la lecture se fait par URL signée temporaire.';
comment on column public.convoyeurs.video_duree_secondes is
  'Durée mesurée à l''envoi. Plafond métier : 60 s (convoyage), 120 s (renfort).';

-- Formats réellement pris en charge et testés.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'convoyeurs_video_mime_valide') then
    alter table public.convoyeurs
      add constraint convoyeurs_video_mime_valide
      check (video_mime is null or video_mime in ('video/mp4', 'video/quicktime', 'video/webm'))
      not valid;
  end if;

  -- Plafond absolu de durée : 120 s. Le plafond plus strict de 60 s pour
  -- une candidature sans renfort dépend des activités et reste vérifié
  -- côté application (il peut changer si les activités changent).
  if not exists (select 1 from pg_constraint where conname = 'convoyeurs_video_duree_plafond') then
    alter table public.convoyeurs
      add constraint convoyeurs_video_duree_plafond
      check (video_duree_secondes is null or video_duree_secondes <= 120)
      not valid;
  end if;

  -- Cohérence : un chemin sans métadonnées (ou l'inverse) est une
  -- écriture partielle, jamais un état légitime.
  if not exists (select 1 from pg_constraint where conname = 'convoyeurs_video_coherente') then
    alter table public.convoyeurs
      add constraint convoyeurs_video_coherente
      check (
        video_chemin is null
        or (video_mime is not null and video_taille_octets is not null and video_envoyee_le is not null)
      )
      not valid;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Bucket PRIVÉ dédié
-- ------------------------------------------------------------
-- 50 Mo par fichier ; types limités au strict nécessaire.
-- « public = false » est le point de sécurité central : aucun objet
-- n'est servi sans URL signée.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidatures-videos',
  'candidatures-videos',
  false,
  52428800,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 3. Politiques d'accès aux objets du bucket
-- ------------------------------------------------------------
-- Convention de nommage des objets (imposée par les politiques) :
--     <auth_user_id>/<nom_de_fichier>
-- Le premier segment du chemin EST l'identifiant du propriétaire :
-- un candidat ne peut donc écrire, remplacer ou supprimer que dans son
-- propre dossier, et rien d'autre.

drop policy if exists "candidature video : depot par le proprietaire" on storage.objects;
create policy "candidature video : depot par le proprietaire"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'candidatures-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "candidature video : remplacement par le proprietaire" on storage.objects;
create policy "candidature video : remplacement par le proprietaire"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'candidatures-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'candidatures-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "candidature video : suppression par le proprietaire" on storage.objects;
create policy "candidature video : suppression par le proprietaire"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'candidatures-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lecture : le propriétaire (pour se relire) ET les administrateurs
-- actifs. Personne d'autre — et jamais en anonyme.
drop policy if exists "candidature video : lecture proprietaire ou admin" on storage.objects;
create policy "candidature video : lecture proprietaire ou admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'candidatures-videos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.est_admin()
    )
  );

-- ------------------------------------------------------------
-- 4. RÉGLAGES MANUELS À FAIRE DANS SUPABASE (hors SQL)
-- ------------------------------------------------------------
-- a) Storage > candidatures-videos : vérifier que le bucket est bien
--    marqué « Private » dans l'interface.
-- b) Aucune clé service_role ne doit être placée dans une page du site :
--    l'URL signée est générée depuis une session authentifiée
--    (createSignedUrl), après le contrôle d'autorisation ci-dessus.
-- c) Durée de validité conseillée d'une URL signée : 60 à 300 s.
-- d) CONSERVATION : prévoir une purge des vidéos des candidatures
--    refusées ou inactives (par exemple 12 mois), et mentionner la
--    finalité + la durée de conservation dans la politique de
--    confidentialité avant toute mise en service.
