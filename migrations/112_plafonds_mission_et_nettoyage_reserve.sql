-- ============================================================
-- HelixCar — 112 : plafonds Mission / Type de mission (C01) et
--                  nettoyage réservé aux entreprises (F01-010)
-- ============================================================
-- Dépend de : 92_creation_demande_atomique.sql (creer_demande_avec_vehicules
--             écrit public.clients ; les déclencheurs ci-dessous s'y
--             appliquent comme à toute écriture, RPC ou REST).
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : une fonction de déclencheur et un déclencheur
-- BEFORE INSERT OR UPDATE sur public.clients. Aucune colonne retirée,
-- aucune ligne modifiée, aucune RLS affaiblie (G01-007), aucune
-- politique touchée. Les migrations 00 à 111 ne sont pas retouchées.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT (lot F01, décisions C01 et F01-010)
-- ------------------------------------------------------------
--   1. Le texte « Mission » (Technicien automobile) débordait sur le
--      titre « Informations complémentaires » du devis PDF. Le plafond
--      est fixé à 166 caractères, espaces et accents compris : la
--      longueur exacte de « Diagnostic électronique complet de plusieurs
--      véhicules présentant des défauts intermittents, contrôle des
--      calculateurs, vérification des systèmes d’aide à la conduite ».
--      Le point final ferait 167 : refusé.
--   2. Même principe pour « Type de mission » (Renfort automobile sur
--      site) : 156 caractères, longueur exacte de « Gestion administrative
--      temporaire de dossiers clients, contrôle des documents, mise à
--      jour des statuts de préparation et coordination des entrées et
--      sorties ».
--   3. « Nettoyage automobile professionnel » est réservé aux
--      entreprises. Le formulaire grisait les conditions d'intervention
--      pour un particulier, mais rien côté serveur n'empêchait une
--      requête forcée (REST ou RPC) de déposer une demande de nettoyage
--      avec type_client = 'particulier'.
--
-- ------------------------------------------------------------
-- POURQUOI UN DÉCLENCHEUR, ET NON UNE CONTRAINTE CHECK DE TABLE
-- ------------------------------------------------------------
-- La règle est bien un CONTRÔLE de longueur (char_length), mais elle ne
-- doit s'appliquer qu'aux NOUVELLES saisies : une contrainte CHECK de
-- table — même déclarée NOT VALID — s'appliquerait aussi à toute mise à
-- jour d'une ligne ancienne (changement de statut par l'administrateur,
-- rattachement à un compte, complément d'informations), et un ancien
-- dossier dont le texte dépasse deviendrait impossible à faire vivre.
-- Le déclencheur, lui, compare l'ancienne et la nouvelle valeur : il ne
-- juge que ce qui CHANGE. Rien n'est tronqué, rien n'est réécrit, rien
-- d'accepté hier ne devient illisible. Le dépassement des données
-- existantes est seulement INVENTORIÉ (notice) à l'application.
--
-- Les refus portent un code métier stable en tête du message
-- (HC_RESERVE_ENTREPRISES, HC_PLAFOND_MISSION, HC_PLAFOND_TYPE_MISSION),
-- errcode check_violation (23514) : le navigateur reconnaît le code et
-- affiche une phrase HelixCar, jamais le texte SQL (G01-009).

-- ------------------------------------------------------------
-- 1. LA FONCTION DE VERROU
-- ------------------------------------------------------------
create or replace function public.verrou_demande_formulaire()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_insertion     boolean := (tg_op = 'INSERT');
  v_service_ancien text := null;
  v_type_ancien    text := null;
  v_desc           text := null;
  v_desc_ancienne  text := null;
  v_categorie      text := null;
  v_categorie_ancienne text := null;
  v_max            integer;
  v_code           text;
  v_libelle        text;
begin
  if not v_insertion then
    v_service_ancien := old.type_service;
    v_type_ancien    := old.type_client;
    if old.professionnel_details is not null
       and jsonb_typeof(old.professionnel_details) = 'object' then
      v_desc_ancienne := old.professionnel_details ->> 'description';
      v_categorie_ancienne := old.professionnel_details ->> 'categorie';
    end if;
  end if;

  -- 1. Nettoyage réservé aux entreprises. Jugé à la création, et lors
  --    d'une mise à jour seulement si le service ou le type de client
  --    change : un ancien dossier n'est jamais bloqué par ailleurs.
  if new.type_service = 'nettoyage'
     and (v_insertion
          or new.type_service is distinct from v_service_ancien
          or new.type_client  is distinct from v_type_ancien)
     and coalesce(new.type_client, '') <> 'pro' then
    raise exception 'HC_RESERVE_ENTREPRISES : le nettoyage automobile professionnel est réservé aux entreprises.'
      using errcode = 'check_violation',
            constraint = 'clients_nettoyage_reserve_entreprises',
            hint = 'type_client doit valoir ''pro'' pour type_service = ''nettoyage''.';
  end if;

  -- 2. Plafonds de « Mission » / « Type de mission ». Jugés à la
  --    création, et si le texte OU la catégorie change. Changer seulement
  --    Technicien en Renfort ne permet pas de contourner la limite de 156.
  if new.professionnel_details is not null
     and jsonb_typeof(new.professionnel_details) = 'object' then
    v_desc := new.professionnel_details ->> 'description';
    v_categorie := new.professionnel_details ->> 'categorie';
    if v_desc is not null
       and (v_insertion or v_desc is distinct from v_desc_ancienne
            or v_categorie is distinct from v_categorie_ancienne) then
      if v_categorie = 'renfort' then
        v_max := 156; v_code := 'HC_PLAFOND_TYPE_MISSION'; v_libelle := 'Type de mission';
      else
        v_max := 166; v_code := 'HC_PLAFOND_MISSION';      v_libelle := 'Mission';
      end if;
      if char_length(v_desc) > v_max then
        raise exception '% : « % » est limité à % caractères, espaces et accents compris (% saisis).',
          v_code, v_libelle, v_max, char_length(v_desc)
          using errcode = 'check_violation',
                constraint = case when v_categorie = 'renfort'
                                  then 'clients_plafond_type_mission_156'
                                  else 'clients_plafond_mission_166' end,
                hint = 'Raccourcissez le texte : la limite est identique dans le formulaire et sur le devis.';
      end if;
    end if;
  end if;

  return new;
end $$;

comment on function public.verrou_demande_formulaire() is
  'Verrou serveur du formulaire de demande (lot F01, décision C01). '
  'Refuse une demande de nettoyage dont type_client n''est pas ''pro'' '
  '(HC_RESERVE_ENTREPRISES), et un texte professionnel_details.description '
  'de plus de 166 caractères (Mission, HC_PLAFOND_MISSION) ou de plus de '
  '156 caractères pour la catégorie renfort (Type de mission, '
  'HC_PLAFOND_TYPE_MISSION), mesurés avec char_length. Ne juge que ce qui '
  'CHANGE : les dossiers existants restent lisibles et modifiables.';

-- ------------------------------------------------------------
-- 2. LE DÉCLENCHEUR
-- ------------------------------------------------------------
drop trigger if exists trg_verrou_demande_formulaire on public.clients;
create trigger trg_verrou_demande_formulaire
  before insert or update of type_service, type_client, professionnel_details
  on public.clients
  for each row
  execute function public.verrou_demande_formulaire();

-- ------------------------------------------------------------
-- 3. INVENTAIRE DES DÉPASSEMENTS EXISTANTS (lecture seule)
-- ------------------------------------------------------------
-- Rien n'est modifié : les dossiers déjà acceptés sont conservés tels
-- quels (version envoyée, PDF déjà produits). Le compte est seulement
-- affiché à l'application, pour que la recette sache s'il reste des
-- textes à raccourcir explicitement lors d'une nouvelle saisie.
do $$
declare
  v_mission integer;
  v_type    integer;
  v_nett    integer;
begin
  select count(*) into v_mission
    from public.clients
   where professionnel_details is not null
     and jsonb_typeof(professionnel_details) = 'object'
     and coalesce(professionnel_details ->> 'categorie', '') <> 'renfort'
     and char_length(coalesce(professionnel_details ->> 'description', '')) > 166;
  select count(*) into v_type
    from public.clients
   where professionnel_details is not null
     and jsonb_typeof(professionnel_details) = 'object'
     and professionnel_details ->> 'categorie' = 'renfort'
     and char_length(coalesce(professionnel_details ->> 'description', '')) > 156;
  select count(*) into v_nett
    from public.clients
   where type_service = 'nettoyage' and coalesce(type_client, '') <> 'pro';
  raise notice 'HelixCar 112 — inventaire (aucune ligne modifiée) : % Mission > 166, % Type de mission > 156, % nettoyage non professionnel.',
    v_mission, v_type, v_nett;
end $$;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.clients'::regclass
--      and tgname = 'trg_verrou_demande_formulaire';
--   -- attendu : 1 ligne, tgenabled = 'O'
--
--   -- Refus attendu (HC_PLAFOND_MISSION) :
--   insert into public.clients (numero_client, type_service, professionnel_details)
--   values ('TEST-QA-CLAUDE-HELIXCAR-112', 'professionnel',
--           jsonb_build_object('categorie', 'technicien', 'description', repeat('a', 167)));
--
--   -- Refus attendu (HC_RESERVE_ENTREPRISES) :
--   insert into public.clients (numero_client, type_service, type_client)
--   values ('TEST-QA-CLAUDE-HELIXCAR-112b', 'nettoyage', 'particulier');
--
--   -- Un ancien dossier trop long reste modifiable tant que son texte ne
--   -- change pas : update public.clients set statut = statut where ... ;
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire : le déclencheur ne modifie aucune donnée.
--   2. Retirer le verrou :
--        drop trigger if exists trg_verrou_demande_formulaire on public.clients;
--        drop function if exists public.verrou_demande_formulaire();
--      ⚠️ Une requête forcée peut alors déposer un nettoyage pour un
--      particulier, ou un texte au-delà des plafonds C01 : seul le
--      formulaire les refuserait encore.
