-- ============================================================
-- HelixCar — 98 : une photo justificative doit exister vraiment
-- ============================================================
-- Dépend de : 96_missions_nettoyage.sql, 97_missions_verrou_serveur.sql
-- Idempotent : peut être rejoué sans effet de bord.
--
-- ------------------------------------------------------------
-- LE DÉFAUT
-- ------------------------------------------------------------
-- La migration 97 interdit de déclarer un nettoyage terminé sans photo
-- avant et après. Mais son contrôle, mission_photos_completes(), ne
-- regarde que des LIGNES dans public.mission_photos :
--
--     select exists (select 1 from public.mission_photos p
--                     where p.mission_id = ... and p.etape = 'avant')
--
-- Or la policy d'insertion de 96 ne vérifie qu'une chose : que
-- l'appelant est le partenaire affecté. Elle ne vérifie NI que le
-- chemin appartient à cette mission, NI qu'un fichier existe derrière.
-- Un partenaire pouvait donc écrire directement :
--
--     insert into public.mission_photos (mission_id, etape, chemin)
--     values (..., 'avant', 'missions/.../fichier-inexistant.jpg'),
--            (..., 'apres', 'missions/.../fichier-inexistant.jpg');
--
-- puis passer sa mission à « fini ». Le justificatif n'existait pas :
-- seule sa mention existait. HelixCar validait ensuite une prestation
-- sur des pièces vides — et la migration 97, qui devait l'en empêcher,
-- se contentait de ces mentions.
--
-- Pire : les contrôles Z20 et Z21 de tests/t_rls.sh REPRODUISAIENT ce
-- défaut. Ils inséraient des métadonnées sans jamais créer l'objet
-- Storage correspondant, et concluaient que la mission était justifiée.
-- Un test qui valide le défaut qu'il devrait interdire.
--
-- La colonne ajoutee_par était par ailleurs choisie par l'appelant :
-- rien n'empêchait d'attribuer sa propre photo à quelqu'un d'autre.
--
-- ------------------------------------------------------------
-- L'ARCHITECTURE RETENUE, ET POURQUOI
-- ------------------------------------------------------------
-- Deux voies étaient possibles.
--
--   (a) Un RPC sécurisé appelé après l'envoi, et l'INSERT direct révoqué.
--   (b) Un trigger BEFORE INSERT qui vérifie storage.objects.
--
-- C'est (b) qui est retenu, pour trois raisons.
--
--   1. LE TRIGGER COUVRE TOUS LES CHEMINS D'ÉCRITURE. Un RPC ne protège
--      que les appelants qui l'utilisent : REST, SQL Editor et tout code
--      futur resteraient libres. Le trigger, lui, s'applique à
--      l'insertion elle-même, d'où qu'elle vienne.
--   2. RÉVOQUER L'INSERT CASSERAIT LES PAGES DÉJÀ OUVERTES. Le Dashboard
--      en ligne insère directement après l'envoi. Un navigateur ayant
--      encore l'ancienne page en cache perdrait ses dépôts, sans message
--      utile. Le trigger garde ce chemin fonctionnel — et le rend sûr.
--   3. IL IMPOSE AUSSI L'IDENTITÉ. ajoutee_par est écrasé depuis
--      auth.uid() : aucun RPC supplémentaire n'est nécessaire pour cela.
--
-- Le trigger est SECURITY DEFINER : il lit storage.objects sans être
-- soumis à la RLS de ce schéma, ce qu'un appelant ordinaire ne peut pas
-- faire. C'est précisément pourquoi la vérification doit vivre là.

-- ------------------------------------------------------------
-- 1. Une photo n'est acceptée que si son fichier existe
-- ------------------------------------------------------------
create or replace function public.verrou_photo_mission()
returns trigger language plpgsql security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_prefixe text;
begin
  -- L'identité est CONSTATÉE, jamais déclarée. Une valeur envoyée par
  -- l'appelant est écrasée : personne ne dépose au nom d'un autre.
  new.ajoutee_par := auth.uid();

  -- Le chemin appartient à CETTE mission, et à aucune autre. C'est la
  -- même convention que les politiques Storage de 96 :
  -- « missions/<mission_id>/... ».
  v_prefixe := 'missions/' || new.mission_id::text || '/';
  if new.chemin is null or position(v_prefixe in new.chemin) <> 1 then
    raise exception 'Chemin de photo hors de la mission : %', new.chemin
      using errcode = 'check_violation';
  end if;

  -- Et surtout : LE FICHIER EXISTE. Une ligne sans objet derrière n'est
  -- pas une pièce justificative, c'est une affirmation.
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'missions-photos'
       and o.name = new.chemin
  ) then
    raise exception 'Aucun fichier ne correspond à cette photo : %', new.chemin
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function public.verrou_photo_mission() is
  'Refuse une photo dont le fichier n''existe pas dans le bucket privé, '
  'ou dont le chemin ne désigne pas la mission concernée. Impose '
  'ajoutee_par depuis auth.uid().';

drop trigger if exists trg_verrou_photo_mission on public.mission_photos;
create trigger trg_verrou_photo_mission
  before insert or update on public.mission_photos
  for each row execute function public.verrou_photo_mission();

-- ------------------------------------------------------------
-- 2. Le constat de complétude regarde les FICHIERS
-- ------------------------------------------------------------
-- Remplace la version de 97, qui ne comptait que des lignes. Même
-- signature : rien d'autre n'a besoin de changer.
create or replace function public.mission_photos_completes(p_mission_id uuid)
returns boolean language sql stable security definer
set search_path = public, storage, pg_temp
as $$
  select exists (
           select 1 from public.mission_photos p
             join storage.objects o
               on o.bucket_id = 'missions-photos' and o.name = p.chemin
            where p.mission_id = p_mission_id and p.etape = 'avant')
     and exists (
           select 1 from public.mission_photos p
             join storage.objects o
               on o.bucket_id = 'missions-photos' and o.name = p.chemin
            where p.mission_id = p_mission_id and p.etape = 'apres');
$$;

comment on function public.mission_photos_completes(uuid) is
  'Vrai si la mission porte au moins une photo avant ET une photo après '
  'dont le FICHIER existe réellement dans le bucket privé. Une ligne '
  'sans objet derrière ne compte pas : ce serait une affirmation, pas '
  'une pièce.';

revoke all on function public.mission_photos_completes(uuid) from public;
grant execute on function public.mission_photos_completes(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Le partenaire ne retire toujours pas ses justificatifs
-- ------------------------------------------------------------
-- Rappel de la règle posée par 96, inchangée ici : seule la lecture et
-- le dépôt lui sont ouverts. La suppression reste à l'administrateur,
-- parce qu'une photo constate un état à un instant donné.
--   (aucune policy de suppression n'est accordée au partenaire)

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select tgname from pg_trigger
--    where tgrelid = 'public.mission_photos'::regclass and not tgisinternal;
--   -- attendu : trg_verrou_photo_mission
--
--   -- Doit ÉCHOUER (aucun fichier derrière) :
--   insert into public.mission_photos (mission_id, etape, chemin)
--   values ('<une mission>', 'avant', 'missions/<une mission>/inexistant.jpg');
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   drop trigger  if exists trg_verrou_photo_mission on public.mission_photos;
--   drop function if exists public.verrou_photo_mission();
--   -- puis réappliquer 97 pour retrouver l'ancienne
--   -- mission_photos_completes(), qui ne compte que des lignes.
--
-- Aucune donnée n'est perdue : ces objets ne font que contrôler. Mais
-- revenir dessus rouvre la possibilité de justifier une prestation avec
-- des photos qui n'existent pas.
