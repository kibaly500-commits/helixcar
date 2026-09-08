-- ============================================================
-- HelixCar — 93 : limite du bucket vidéo portée à 300 Mo
-- ============================================================
-- Idempotent : peut être rejoué sans effet de bord.
--
-- POURQUOI. Une vidéo de présentation de deux minutes filmée avec un
-- téléphone récent pèse couramment plus de 200 Mo. La limite de 50 Mo
-- posée par 03_videos_candidature.sql refusait donc des candidatures
-- parfaitement légitimes.
--
-- 03_videos_candidature.sql a DÉJÀ ÉTÉ EXÉCUTÉE en production : elle
-- n'est pas modifiée. La limite est relevée ici, dans une migration
-- distincte, pour que l'historique reste lisible.
--
-- Le bucket reste PRIVÉ et les types acceptés restent les mêmes.

update storage.buckets
   set file_size_limit    = 314572800,          -- 300 Mo
       public             = false,
       allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm']
 where id = 'candidatures-videos';

-- Si le bucket n'existait pas (environnement neuf), on le crée avec la
-- bonne limite plutôt que d'échouer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'candidatures-videos', 'candidatures-videos', false, 314572800,
       array['video/mp4', 'video/quicktime', 'video/webm']
 where not exists (select 1 from storage.buckets where id = 'candidatures-videos');

-- ------------------------------------------------------------
-- RÉGLAGE MANUEL INDISPENSABLE, HORS SQL
-- ------------------------------------------------------------
-- Supabase applique AUSSI une limite GLOBALE au projet, qui prime sur
-- celle du bucket. Tant qu'elle vaut 50 Mo, cette migration ne changera
-- rien de visible.
--
--   Supabase → Storage → Settings → Upload file size limit
--   → porter à 300 Mo au moins.
--
-- Vérification après application :
--   select id, file_size_limit, public from storage.buckets
--    where id = 'candidatures-videos';
--   -- attendu : 314572800, public = false
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   update storage.buckets set file_size_limit = 52428800
--    where id = 'candidatures-videos';
-- Les vidéos déjà déposées au-delà de 50 Mo restent en place : seule
-- l'acceptation des NOUVEAUX envois est concernée.
