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
-- CORRECTION (constatée à l'implémentation) : une première version de
-- ce fichier identifiait le propriétaire par le PREMIER SEGMENT DU
-- CHEMIN (<auth_user_id>/...) et n'autorisait le dépôt qu'aux sessions
-- authentifiées. C'était inapplicable : une candidature partenaire est
-- déposée ANONYMEMENT (index.html envoie le formulaire avec la clé
-- anon, le compte n'est créé qu'ensuite via creer-compte-convoyeur).
-- Avec ces règles, AUCUN candidat n'aurait jamais pu envoyer sa vidéo,
-- et le lien vidéo <-> candidature n'existait nulle part.
--
-- Le lien de propriété est désormais celui qui existe réellement :
--     storage.objects.name = public.convoyeurs.video_chemin
--     et public.convoyeurs.auth_user_id = auth.uid()
-- La vidéo est donc rattachée à LA candidature, et la candidature à SON
-- utilisateur — exactement ce qui est demandé.
--
-- Convention de nommage : 'candidatures/<uuid aléatoire>.<ext>'.
-- Le nom ne porte aucune donnée personnelle et n'est pas devinable.

-- DÉPÔT — AUCUNE écriture anonyme.
-- CORRECTION DE SÉCURITÉ : une version précédente de ce fichier
-- autorisait `anon` à insérer librement sous le préfixe
-- 'candidatures/'. Un bucket privé empêche la LECTURE publique, mais
-- cette politique laissait n'importe qui déposer un objet, choisir son
-- chemin, et donc écrire dans le dossier d'une autre candidature.
-- Elle est SUPPRIMÉE et n'est remplacée par aucune politique anonyme.
--
-- Une candidature est déposée sans compte : le dépôt passe donc
-- EXCLUSIVEMENT par la fonction serveur `candidature-video`
-- (supabase/functions/candidature-video), qui détient la clé
-- service_role — jamais le navigateur. Cette fonction :
--   1. identifie la candidature (jeton à usage unique, ou session
--      authentifiée du propriétaire) ;
--   2. revérifie côté serveur le format, la taille et la durée ;
--   3. GÉNÈRE elle-même le chemin 'candidatures/<id>/<uuid>.<ext>' —
--      le navigateur ne le choisit jamais ;
--   4. délivre une URL d'envoi signée, temporaire et liée à CE chemin.
-- Le navigateur ne peut donc écrire que là où le serveur l'a autorisé.
drop policy if exists "candidature video : depot par le proprietaire" on storage.objects;
drop policy if exists "candidature video : depot de candidature" on storage.objects;

-- Dépôt direct réservé au propriétaire AUTHENTIFIÉ d'une candidature
-- (remplacement depuis son espace, une fois son compte créé) et aux
-- administrateurs. Le chemin doit appartenir au dossier de SA
-- candidature : impossible d'écrire dans celui d'un autre.
drop policy if exists "candidature video : depot par le proprietaire authentifie" on storage.objects;
create policy "candidature video : depot par le proprietaire authentifie"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'candidatures-videos'
    and (
      public.est_admin()
      or exists (
        select 1 from public.convoyeurs c
         where c.auth_user_id = auth.uid()
           and storage.objects.name like 'candidatures/' || c.id::text || '/%'
      )
    )
  );

-- RATTACHEMENT VÉRIFIABLE — un objet appartient à la candidature dont
-- l'identifiant figure dans son chemin : 'candidatures/<id>/<fichier>'.
-- Ce lien est utilisé à l'identique par les trois politiques
-- ci-dessous. Il reste vrai pendant un remplacement (le nouvel objet
-- existe avant que convoyeurs.video_chemin ne soit mis à jour), ce
-- qu'un rattachement par `video_chemin = name` seul ne permettait pas.
create or replace function public.candidature_du_chemin_video(p_nom text)
returns uuid
language sql
immutable
as $$
  select nullif((string_to_array(p_nom, '/'))[2], '')::uuid
   where p_nom like 'candidatures/%/%';
$$;

comment on function public.candidature_du_chemin_video(text) is
  'Identifiant de candidature porté par le chemin d''un objet vidéo. '
  'Sert de lien vérifiable objet <-> candidature dans les politiques.';

-- LECTURE — administrateurs actifs, et le candidat propriétaire une
-- fois son compte créé et rattaché. Jamais en anonyme.
-- C'est cette politique qui conditionne aussi la CRÉATION D'UNE URL
-- SIGNÉE de lecture : sans droit de select sur l'objet, la signature
-- est refusée par le service Storage.
drop policy if exists "candidature video : lecture proprietaire ou admin" on storage.objects;
create policy "candidature video : lecture proprietaire ou admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'candidatures-videos'
    and (
      public.est_admin()
      or exists (
        select 1 from public.convoyeurs c
         where c.id = public.candidature_du_chemin_video(storage.objects.name)
           and c.auth_user_id = auth.uid()
      )
    )
  );

-- REMPLACEMENT — même règle de propriété.
drop policy if exists "candidature video : remplacement par le proprietaire" on storage.objects;
create policy "candidature video : remplacement par le proprietaire"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'candidatures-videos'
    and (
      public.est_admin()
      or exists (
        select 1 from public.convoyeurs c
         where c.id = public.candidature_du_chemin_video(storage.objects.name)
           and c.auth_user_id = auth.uid()
      )
    )
  )
  with check (bucket_id = 'candidatures-videos');

-- SUPPRESSION — même règle de propriété. Sert au remplacement propre
-- de l'ancien fichier une fois la candidature rattachée à un compte.
drop policy if exists "candidature video : suppression par le proprietaire" on storage.objects;
create policy "candidature video : suppression par le proprietaire"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'candidatures-videos'
    and (
      public.est_admin()
      or exists (
        select 1 from public.convoyeurs c
         where c.id = public.candidature_du_chemin_video(storage.objects.name)
           and c.auth_user_id = auth.uid()
      )
    )
  );

-- Retrouver rapidement la candidature portant un objet donné.
create index if not exists convoyeurs_video_chemin_idx
  on public.convoyeurs (video_chemin);

-- ------------------------------------------------------------
-- 3 bis. AUTORISATION D'ENVOI TEMPORAIRE
-- ------------------------------------------------------------
-- Une candidature déposée sans compte doit tout de même prouver, au
-- moment de l'envoi, qu'elle est bien celle qui vient d'être créée par
-- CE navigateur. Un jeton à usage unique est généré par le navigateur,
-- puis enregistré ici UNIQUEMENT SOUS SA FORME HACHÉE (SHA-256) —
-- même convention que le token de devis déjà en place : la base ne
-- contient jamais le secret en clair.
alter table public.convoyeurs
  add column if not exists video_upload_jeton_hash text;

comment on column public.convoyeurs.video_upload_jeton_hash is
  'SHA-256 du jeton d''envoi vidéo à usage unique. Effacé dès que la '
  'vidéo est confirmée. Jamais le secret en clair, jamais une URL.';

create index if not exists convoyeurs_video_upload_jeton_idx
  on public.convoyeurs (video_upload_jeton_hash)
  where video_upload_jeton_hash is not null;

-- La fenêtre d'utilisation du jeton n'est PAS une colonne modifiable
-- par le client : elle est dérivée de created_at et vérifiée par la
-- fonction serveur. Un navigateur ne peut donc pas se l'allonger.

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
-- e) DÉPÔTS ORPHELINS : la vidéo est envoyée juste avant l'insertion de
--    la candidature. Si l'insertion échoue après un envoi réussi (cas
--    rare), le fichier reste dans le bucket sans candidature associée.
--    Aucun droit de suppression anonyme n'est accordé pour cela — ce
--    serait un moyen de détruire le dépôt d'autrui. Purge à passer
--    périodiquement par un administrateur :
--
--      select o.name, o.created_at
--        from storage.objects o
--       where o.bucket_id = 'candidatures-videos'
--         and o.created_at < now() - interval '24 hours'
--         and not exists (
--               select 1 from public.convoyeurs c
--                where c.video_chemin = o.name
--             );
--
--    puis suppression des objets listés depuis l'interface Storage.

-- ------------------------------------------------------------
-- 5. VÉRIFICATION MANUELLE RECOMMANDÉE APRÈS APPLICATION
-- ------------------------------------------------------------
-- 1. Depuis une session ANONYME (clé anon), tenter :
--      select * from storage.objects where bucket_id = 'candidatures-videos';
--    -> doit renvoyer 0 ligne (aucune lecture anonyme).
-- 2. Depuis la session d'un candidat A rattaché, tenter de lire l'objet
--    d'un candidat B -> doit renvoyer 0 ligne.
-- 3. Depuis un compte NON administrateur et non propriétaire, la
--    création d'une URL signée doit échouer.
-- 4. Vérifier qu'aucune URL du bucket ne fonctionne sans signature :
--      https://<projet>.supabase.co/storage/v1/object/public/candidatures-videos/<chemin>
--    -> doit répondre une erreur, jamais la vidéo.
