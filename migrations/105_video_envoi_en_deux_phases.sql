-- ============================================================
-- HelixCar — 105 : l'envoi de la vidéo de candidature en deux phases
-- ============================================================
-- Dépend de : 00_helpers.sql, 03_videos_candidature.sql,
--             90_durcissement_rls_partenaires.sql
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : six colonnes nullables, trois contraintes de
-- cohérence sur ces SEULES nouvelles colonnes, un index partiel, une
-- fonction de finalisation, et le garde-fou de la migration 90 remplacé
-- par « create or replace ». Aucune donnée modifiée, aucune contrainte
-- existante affaiblie ni supprimée, aucune RLS désactivée, aucun bucket
-- ouvert.
--
-- LES MIGRATIONS 92 À 104 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- LE DÉFAUT DE PRODUCTION (code 23514)
-- ------------------------------------------------------------
-- La contrainte `convoyeurs_video_coherente` (migration 03) exige :
--
--     video_chemin is null
--     or (video_mime is not null and video_taille_octets is not null
--         and video_envoyee_le is not null)
--
-- Or l'action « autoriser » de la fonction serveur candidature-video
-- écrivait le chemin, le MIME et la taille AVANT l'envoi, en laissant
-- volontairement `video_envoyee_le` à NULL pour marquer « pas encore
-- reçue ». Cette première écriture est précisément l'état que la
-- contrainte interdit. Journaux réels :
--
--     code: 23514  constraint: convoyeurs_video_coherente
--     new row for relation "convoyeurs" violates check constraint
--
-- La base avait raison : un chemin sans date d'envoi EST une écriture
-- partielle. La contrainte n'est donc ni relâchée ni supprimée, et
-- aucune date n'est inventée pour la contourner. C'est le flux qui
-- change : l'envoi EN COURS vit dans ses propres colonnes, et les
-- quatre colonnes finales ne sont écrites qu'ENSEMBLE, dans une seule
-- instruction, une fois le fichier réellement vérifié dans le bucket.
--
-- ------------------------------------------------------------
-- LE SECOND DÉFAUT, LATENT, QUI AURAIT SUIVI
-- ------------------------------------------------------------
-- La confirmation fait passer la candidature de `video_attendue` à
-- `en_attente`. Le garde-fou `garde_colonnes_sensibles_convoyeur`
-- (migration 90) refuse tout changement de `statut` dès que
-- `est_admin()` est faux. Or la fonction serveur travaille avec la clé
-- service_role : `auth.uid()` y est NUL, `est_admin()` y est donc FAUX,
-- et la finalisation aurait levé « Modification réservée à un
-- administrateur ». Reproduit sur PostgreSQL 16 (tests/t_rls.sh,
-- section VID). Le garde-fou adopte la convention déjà retenue par la
-- migration 97 : sans session, ce n'est pas lui qui filtre, c'est la
-- RLS — et `anon` n'a AUCUNE politique de mise à jour sur convoyeurs.
-- Il est en revanche RENFORCÉ : un partenaire authentifié ne peut plus
-- toucher lui-même aux colonnes vidéo, réservées à la fonction serveur.

-- ------------------------------------------------------------
-- 1. L'ENVOI EN COURS, DANS SES PROPRES COLONNES
-- ------------------------------------------------------------
alter table public.convoyeurs
  add column if not exists video_envoi_chemin             text,
  add column if not exists video_envoi_mime               text,
  add column if not exists video_envoi_taille_octets      bigint,
  add column if not exists video_envoi_duree_secondes     numeric(6,2),
  add column if not exists video_envoi_commence_le        timestamptz,
  add column if not exists video_upload_jeton_consomme_le timestamptz;

comment on column public.convoyeurs.video_envoi_chemin is
  'Chemin AUTORISÉ pour un envoi en cours, généré par la fonction '
  'serveur. Jamais une vidéo reçue : video_chemin ne prend cette valeur '
  'qu''à la finalisation, une fois l''objet vérifié dans le bucket.';
comment on column public.convoyeurs.video_envoi_commence_le is
  'Instant où l''envoi a été autorisé. Sert à la réconciliation des '
  'envois abandonnés, jamais à déclarer une vidéo reçue.';
comment on column public.convoyeurs.video_upload_jeton_consomme_le is
  'Instant où le jeton à usage unique a été consommé par la '
  'finalisation. L''empreinte est conservée pour rendre la confirmation '
  'IDEMPOTENTE (réponse perdue, second clic) : un jeton consommé ne '
  'peut plus autoriser aucune écriture.';

-- Même cohérence que sur les colonnes finales : un envoi en cours sans
-- MIME, sans taille ou sans instant de départ est une écriture
-- partielle, jamais un état légitime.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'convoyeurs_video_envoi_coherent') then
    alter table public.convoyeurs
      add constraint convoyeurs_video_envoi_coherent
      check (
        video_envoi_chemin is null
        or (video_envoi_mime is not null
            and video_envoi_taille_octets is not null
            and video_envoi_commence_le is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'convoyeurs_video_envoi_mime_valide') then
    alter table public.convoyeurs
      add constraint convoyeurs_video_envoi_mime_valide
      check (video_envoi_mime is null
             or video_envoi_mime in ('video/mp4', 'video/quicktime', 'video/webm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'convoyeurs_video_envoi_duree_plafond') then
    alter table public.convoyeurs
      add constraint convoyeurs_video_envoi_duree_plafond
      check (video_envoi_duree_secondes is null or video_envoi_duree_secondes <= 120);
  end if;
end $$;

create index if not exists convoyeurs_video_envoi_chemin_idx
  on public.convoyeurs (video_envoi_chemin)
  where video_envoi_chemin is not null;

-- ------------------------------------------------------------
-- 2. LA FINALISATION : QUATRE COLONNES, UNE SEULE INSTRUCTION
-- ------------------------------------------------------------
-- Appelée par la fonction serveur, APRÈS qu'elle a vérifié la présence
-- réelle de l'objet dans le bucket privé et lu sa taille. Elle :
--   * refuse de finaliser sans envoi en cours (AUCUN_ENVOI) ;
--   * refuse une taille réelle différente de la taille déclarée
--     (TAILLE_INCOHERENTE) : un envoi tronqué ne devient jamais une
--     vidéo reçue ;
--   * écrit video_chemin, video_mime, video_taille_octets et
--     video_envoyee_le ENSEMBLE — la contrainte de 03 est satisfaite à
--     chaque instant, sans jamais être contournée ;
--   * vide les colonnes d'envoi en cours, consomme le jeton et fait
--     passer la candidature de video_attendue à en_attente ;
--   * est IDEMPOTENTE : rappelée après succès, elle répond
--     DEJA_FINALISEE sans rien réécrire.
-- La date d'envoi est celle de la finalisation réelle, jamais une
-- valeur transmise par l'appelant.
create or replace function public.finaliser_video_candidature(
  p_convoyeur_id  uuid,
  p_taille_reelle bigint default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c        public.convoyeurs%rowtype;
  v_ancien text;
  v_statut text;
begin
  select * into c from public.convoyeurs where id = p_convoyeur_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;

  if c.video_envoi_chemin is null then
    if c.video_chemin is not null and c.video_envoyee_le is not null then
      return jsonb_build_object('ok', true, 'code', 'DEJA_FINALISEE',
                                'chemin', c.video_chemin, 'statut', c.statut);
    end if;
    return jsonb_build_object('ok', false, 'code', 'AUCUN_ENVOI');
  end if;

  if p_taille_reelle is not null and p_taille_reelle <> c.video_envoi_taille_octets then
    return jsonb_build_object('ok', false, 'code', 'TAILLE_INCOHERENTE',
                              'declaree', c.video_envoi_taille_octets,
                              'reelle', p_taille_reelle);
  end if;

  -- L'ancienne vidéo, si elle existe et diffère : renvoyée pour que la
  -- fonction serveur supprime le fichier devenu orphelin.
  v_ancien := case when c.video_chemin is not null
                    and c.video_chemin is distinct from c.video_envoi_chemin
                   then c.video_chemin end;
  v_statut := case when c.statut = 'video_attendue' then 'en_attente' else c.statut end;

  update public.convoyeurs
     set video_chemin                   = c.video_envoi_chemin,
         video_mime                     = c.video_envoi_mime,
         video_taille_octets            = coalesce(p_taille_reelle, c.video_envoi_taille_octets),
         video_duree_secondes           = c.video_envoi_duree_secondes,
         video_envoyee_le               = now(),
         video_envoi_chemin             = null,
         video_envoi_mime               = null,
         video_envoi_taille_octets      = null,
         video_envoi_duree_secondes     = null,
         video_envoi_commence_le        = null,
         video_upload_jeton_consomme_le = coalesce(video_upload_jeton_consomme_le, now()),
         statut                         = v_statut
   where id = p_convoyeur_id;

  return jsonb_build_object('ok', true, 'code', 'FINALISEE',
                            'chemin', c.video_envoi_chemin,
                            'ancien_chemin', v_ancien,
                            'statut', v_statut);
end $$;

-- Réservée au serveur : ni anon, ni authenticated, ni public. Seule la
-- clé service_role de la fonction candidature-video peut l'appeler.
revoke all on function public.finaliser_video_candidature(uuid, bigint) from public;
revoke all on function public.finaliser_video_candidature(uuid, bigint) from anon;
revoke all on function public.finaliser_video_candidature(uuid, bigint) from authenticated;
grant execute on function public.finaliser_video_candidature(uuid, bigint) to service_role;

comment on function public.finaliser_video_candidature(uuid, bigint) is
  'Finalise un envoi vidéo vérifié : écrit ENSEMBLE les quatre colonnes '
  'finales (contrainte 03 respectée à chaque instant), vide l''envoi en '
  'cours, consomme le jeton, passe video_attendue en en_attente. '
  'Idempotente. Réservée à service_role.';

-- ------------------------------------------------------------
-- 3. LE GARDE-FOU DE 90, ALIGNÉ SUR 97 ET RENFORCÉ
-- ------------------------------------------------------------
-- Corps repris de la migration 90 à l'identique, avec deux ajouts :
--   * sans session (auth.uid() nul : fonction serveur, maintenance,
--     migration), le trigger laisse passer — exactement comme le verrou
--     des missions de la migration 97. Ce n'est pas une ouverture :
--     `anon` n'a aucune politique de mise à jour sur convoyeurs, la RLS
--     le refuse avant que le trigger ne s'exécute ;
--   * un partenaire authentifié non administrateur ne peut plus
--     modifier lui-même les colonnes vidéo : elles sont écrites par la
--     fonction serveur, après contrôle du format, de la taille, de la
--     durée et de la présence réelle du fichier. Une écriture directe
--     par l'API REST pourrait sinon pointer le chemin d'une autre
--     candidature ou déclarer reçue une vidéo qui n'existe pas.
create or replace function public.garde_colonnes_sensibles_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.est_admin() then
    return new;
  end if;
  if new.bloque       is distinct from old.bloque
     or new.bloque_le    is distinct from old.bloque_le
     or new.bloque_par   is distinct from old.bloque_par
     or new.bloque_motif is distinct from old.bloque_motif
     or new.statut       is distinct from old.statut then
    raise exception 'Modification réservée à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.video_chemin                   is distinct from old.video_chemin
     or new.video_mime                     is distinct from old.video_mime
     or new.video_taille_octets            is distinct from old.video_taille_octets
     or new.video_duree_secondes           is distinct from old.video_duree_secondes
     or new.video_envoyee_le               is distinct from old.video_envoyee_le
     or new.video_envoi_chemin             is distinct from old.video_envoi_chemin
     or new.video_envoi_mime               is distinct from old.video_envoi_mime
     or new.video_envoi_taille_octets      is distinct from old.video_envoi_taille_octets
     or new.video_envoi_duree_secondes     is distinct from old.video_envoi_duree_secondes
     or new.video_envoi_commence_le        is distinct from old.video_envoi_commence_le
     or new.video_upload_jeton_hash        is distinct from old.video_upload_jeton_hash
     or new.video_upload_jeton_consomme_le is distinct from old.video_upload_jeton_consomme_le then
    raise exception 'La vidéo de candidature est gérée par le serveur.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- Le trigger de 90 reste en place : « create or replace » a remplacé le
-- corps de la fonction qu'il appelle. Recréé ici pour un environnement
-- où 90 ne serait pas encore passée (aucun effet sinon).
drop trigger if exists trg_garde_colonnes_sensibles_convoyeur on public.convoyeurs;
create trigger trg_garde_colonnes_sensibles_convoyeur
  before update on public.convoyeurs
  for each row execute function public.garde_colonnes_sensibles_convoyeur();

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from information_schema.columns
--    where table_name = 'convoyeurs'
--      and column_name in ('video_envoi_chemin','video_envoi_mime',
--                          'video_envoi_taille_octets','video_envoi_duree_secondes',
--                          'video_envoi_commence_le','video_upload_jeton_consomme_le');
--   -- attendu : 6
--
--   select conname from pg_constraint
--    where conrelid = 'public.convoyeurs'::regclass
--      and conname in ('convoyeurs_video_coherente','convoyeurs_video_envoi_coherent');
--   -- attendu : les DEUX (l'ancienne n'a pas bougé)
--
--   select count(*) from information_schema.role_routine_grants
--    where routine_name = 'finaliser_video_candidature'
--      and grantee in ('anon','authenticated');
--   -- attendu : 0
--
--   -- Envois en cours abandonnés (réconciliation, à passer à la main) :
--   select id, video_envoi_chemin, video_envoi_commence_le
--     from public.convoyeurs
--    where video_envoi_chemin is not null
--      and video_envoi_commence_le < now() - interval '24 hours';
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire : ce fichier n'ajoute que des colonnes vides et
--      des garanties. Les vidéos déjà reçues ne sont pas touchées.
--   2. Retirer la fonction de finalisation :
--        drop function if exists public.finaliser_video_candidature(uuid, bigint);
--      ⚠️ La fonction serveur candidature-video ne peut alors plus
--      confirmer aucune vidéo.
--   3. Revenir au garde-fou de 90 : réappliquer
--      migrations/90_durcissement_rls_partenaires.sql (create or replace).
--      ⚠️ La finalisation serveur redevient impossible (statut refusé).
--   4. Retirer les colonnes (DESTRUCTIF pour les envois en cours) :
--        alter table public.convoyeurs
--          drop column if exists video_envoi_chemin,
--          drop column if exists video_envoi_mime,
--          drop column if exists video_envoi_taille_octets,
--          drop column if exists video_envoi_duree_secondes,
--          drop column if exists video_envoi_commence_le,
--          drop column if exists video_upload_jeton_consomme_le;
