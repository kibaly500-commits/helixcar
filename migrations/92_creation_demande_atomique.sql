-- ============================================================
-- HelixCar — 92 : création atomique d'une demande et de ses véhicules
-- ============================================================
-- Dépend de : 00_helpers.sql, 91_durcissement_rls_clients.sql
-- Idempotent : peut être rejoué sans effet de bord.
--
-- ------------------------------------------------------------
-- CAUSE EXACTE DE L'ERREUR 42501 SUR public.vehicules
-- ------------------------------------------------------------
-- Reproduite sur un PostgreSQL 16 local (cf. tests/t_rls.sh, section V).
--
-- public.vehicules porte une RLS dont la policy d'INSERT vérifie que le
-- dossier parent existe :
--
--     with check (exists (select 1 from public.clients c
--                          where c.id = vehicules.dossier_id))
--
-- Tant que public.clients n'avait AUCUNE RLS, cette sous-requête voyait
-- la ligne et l'insertion passait. Depuis 91_durcissement_rls_clients,
-- public.clients est protégée et n'accorde — volontairement — AUCUNE
-- politique de lecture à `anon` : un visiteur anonyme ne voit donc plus
-- la demande qu'il vient pourtant de créer. La sous-requête ne renvoie
-- plus rien, le WITH CHECK est faux, et PostgreSQL rejette avec
-- « new row violates row-level security policy for table "vehicules" ».
--
-- Aucune migration du dépôt n'a jamais touché public.vehicules : sa
-- policy vient du projet Supabase. C'est pourquoi le durcissement des
-- demandes l'a cassée sans que rien ne le signale.
--
-- Le même incident laissait une CRÉATION PARTIELLE : la ligne clients
-- était déjà écrite quand les véhicules échouaient.
--
-- ------------------------------------------------------------
-- CORRECTION RETENUE
-- ------------------------------------------------------------
-- Une fonction SECURITY DEFINER qui écrit la demande ET ses véhicules
-- dans UNE SEULE transaction. Elle règle les deux problèmes à la fois :
--   * l'écriture n'est plus soumise aux policies contradictoires, sans
--     désactiver la RLS ni ouvrir la moindre écriture anonyme générale ;
--   * soit tout est écrit, soit rien ne l'est — plus de demande
--     orpheline sans ses véhicules.
--
-- ------------------------------------------------------------
-- DEUX DÉFAUTS CORRIGÉS DANS CETTE VERSION
-- ------------------------------------------------------------
-- Cette fonction est exécutable par `anon`. Deux points de la première
-- version ne tenaient pas cette exigence.
--
-- 1. LES COLONNES ÉCRITES ÉTAIENT CHOISIES PAR EXCLUSION.
--    Une liste de noms interdits, plus un motif (« prix », « admin »,
--    « valide »...). Tout ce qui n'y ressemblait pas passait. Une
--    colonne sensible dont le nom ne contient aucun de ces mots — hier
--    ou demain — était donc écrite par le navigateur. Les véhicules
--    n'avaient même pas ce filtre : quatre noms exclus, et rien d'autre.
--    → Remplacé par des LISTES BLANCHES explicites. Toute clé absente
--      de la liste est ignorée, qu'elle existe déjà ou qu'elle soit
--      ajoutée plus tard. Une colonne nouvelle est fermée par défaut.
--
-- 2. L'IDENTIFIANT SEUL VALAIT PREUVE DE REJEU.
--    La fonction testait « cette demande existe-t-elle ? » et, si oui,
--    sautait la création puis rattachait les véhicules et renvoyait le
--    numéro client. Connaître — ou deviner — l'UUID d'une demande
--    suffisait donc à y GREFFER SES PROPRES VÉHICULES et à LIRE le
--    numéro client d'autrui. L'existence d'une ligne ne prouve rien.
--    → Un rejeu doit être PROUVÉ. Le navigateur tire un secret de
--      création ; seule son empreinte est stockée (clients.creation_cle_hash).
--      Un rejeu n'est reconnu que si le secret correspond, ou si
--      l'appelant est authentifié et déjà propriétaire de la ligne.
--      Sinon la demande visée n'est ni lue ni modifiée : un identifiant
--      neuf est tiré, et rien de l'existant ne fuit — pas même le fait
--      qu'elle existe.

-- ------------------------------------------------------------
-- 1. Empreinte du secret de création
-- ------------------------------------------------------------
-- Le secret lui-même n'est JAMAIS stocké : seule son empreinte SHA-256
-- l'est, comme pour le jeton d'envoi vidéo. Colonne facultative : une
-- demande créée avant cette migration n'en a pas, et reste lisible.
alter table public.clients
  add column if not exists creation_cle_hash text;

comment on column public.clients.creation_cle_hash is
  'Empreinte SHA-256 du secret de création tiré par le navigateur. '
  'Sert UNIQUEMENT à prouver qu''un appel rejoué émane bien de celui '
  'qui a créé la demande. Jamais lue par le client, jamais affichée.';

create index if not exists clients_creation_cle_hash_idx
  on public.clients (creation_cle_hash)
  where creation_cle_hash is not null;

-- ------------------------------------------------------------
-- 1 bis. Une empreinte PAR USAGE — la séparation est structurelle
-- ------------------------------------------------------------
-- Le secret de création et le secret de réclamation (migration 99) ne
-- doivent jamais être interchangeables. Les tirer au hasard rend la
-- collision improbable ; la préfixer par son USAGE la rend IMPOSSIBLE.
--
-- Même si le même texte était présenté aux deux mécanismes, il ne
-- produirait pas la même empreinte : un secret qui satisfait
-- reclamation_cle_hash ne peut donc pas satisfaire creation_cle_hash.
-- Ce n'est plus une question de probabilité, mais de construction.
create or replace function public.empreinte_secret(
  p_usage text,
  p_cle   text
) returns text
language sql
immutable
as $$
  select encode(
           sha256(convert_to(coalesce(p_usage, '') || ':' || coalesce(p_cle, ''),
                             'UTF8')),
           'hex')
$$;

comment on function public.empreinte_secret(text, text) is
  'Empreinte SHA-256 d''un secret, préfixée par son usage. La préfixation '
  'garantit qu''un secret valable pour un usage ne vaut rien pour un autre.';

revoke all on function public.empreinte_secret(text, text) from public;

-- ------------------------------------------------------------
-- 2. Listes blanches des colonnes publiques
-- ------------------------------------------------------------
-- Ce que le NAVIGATEUR a le droit d'écrire, et rien d'autre. Ces
-- fonctions sont immuables et lisibles : la revue de sécurité se fait
-- ici, en un seul endroit.
create or replace function public.champs_publics_demande()
returns text[] language sql immutable
as $$
  select array[
    -- Identité et rattachement commercial
    'numero_client', 'code_parrainage', 'parraine_par',
    'prenom', 'nom', 'email', 'telephone',
    'type_client', 'societe', 'siret',
    -- Service demandé
    'type_service', 'disponibilite', 'nb_vehicules', 'trajet_commun',
    'flotte_a_detailler', 'notes',
    'nettoyage_details', 'professionnel_details',
    -- Trajet (demande mono-véhicule historique)
    'type_trajet', 'type_trajet_retour', 'mode_transport',
    'adresse_depart_rue', 'code_postal_depart', 'ville_depart',
    'adresse_arrivee_rue', 'code_postal_arrivee', 'ville_arrivee',
    'date_prise_en_charge', 'heure_prise_en_charge',
    'pc_heure_type', 'pc_creneau_debut', 'pc_creneau_fin',
    'date_livraison', 'heure_livraison',
    'liv_heure_type', 'liv_creneau_debut', 'liv_creneau_fin',
    -- Véhicule (demande mono-véhicule historique)
    'type_vehicule', 'marque_modele', 'immatriculation', 'vin',
    'nettoyage', 'plateau', 'urgence',
    -- Restitution
    'restitution', 'adresse_restitution', 'adresse_restit_rue',
    'code_postal_restit', 'ville_restit',
    'date_restitution', 'heure_restitution',
    'restit_heure_type', 'restit_creneau_debut', 'restit_creneau_fin',
    'restit_type_vehicule', 'restit_marque_modele',
    'restit_immatriculation', 'restit_vin',
    -- Stockage
    'stockage_code_postal', 'stockage_ville',
    'stockage_acheminement', 'stockage_sortie',
    'stockage_nb_vehicules', 'stockage_date_debut', 'stockage_date_fin',
    'stockage_nb_jours', 'stockage_notes',
    'stockage_heure_entree', 'stockage_heure_sortie',
    -- Contacts sur place
    'contact_pc_nom', 'contact_pc_tel', 'contraintes_pc',
    'contact_liv_nom', 'contact_liv_tel', 'contraintes_liv',
    'restit_contact_nom', 'restit_contact_tel', 'contraintes_restit',
    -- Provenance
    'source_acquisition', 'source_acquisition_detail',
    'utm_source', 'utm_medium', 'utm_campaign'
  ]::text[];
$$;

comment on function public.champs_publics_demande() is
  'Liste BLANCHE des colonnes de public.clients qu''un dépôt public a le '
  'droit de renseigner. Toute colonne absente d''ici est ignorée, y '
  'compris une colonne ajoutée après cette migration.';

create or replace function public.champs_publics_vehicule()
returns text[] language sql immutable
as $$
  select array[
    'position', 'type_vehicule', 'marque_modele', 'immatriculation', 'vin',
    'mode_transport', 'consignes',
    'adresse_depart_rue', 'code_postal_depart', 'ville_depart',
    'pc_contact_nom', 'pc_contact_tel',
    'date_prise_en_charge', 'heure_prise_en_charge',
    'pc_heure_type', 'pc_creneau_debut', 'pc_creneau_fin',
    'adresse_arrivee_rue', 'code_postal_arrivee', 'ville_arrivee',
    'livraison_apres_stockage',
    'liv_contact_nom', 'liv_contact_tel',
    'date_livraison', 'heure_livraison',
    'liv_heure_type', 'liv_creneau_debut', 'liv_creneau_fin',
    'restitution_concernee',
    'restit_adresse_rue', 'restit_code_postal', 'restit_ville',
    'restit_contact_nom', 'restit_contact_tel',
    'restit_date', 'restit_heure', 'restit_heure_type',
    'restit_creneau_debut', 'restit_creneau_fin', 'restit_contraintes',
    'heure_recuperation_client',
    'restit_type_vehicule', 'restit_marque_modele',
    'restit_immatriculation', 'restit_vin'
  ]::text[];
$$;

comment on function public.champs_publics_vehicule() is
  'Liste BLANCHE des colonnes de public.vehicules qu''un dépôt public a '
  'le droit de renseigner. Même principe que champs_publics_demande().';

-- ------------------------------------------------------------
-- 3. La création elle-même
-- ------------------------------------------------------------
-- L'ancienne signature (jsonb, jsonb) est retirée : la laisser en place
-- laisserait une porte ouverte sans preuve d'idempotence.
drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb);

-- UNE SEULE SIGNATURE, JAMAIS DEUX.
--
-- Ajouter un paramètre à une fonction PostgreSQL ne remplace pas
-- l'ancienne : elle en crée une seconde. PostgREST se retrouverait alors
-- devant deux candidates pour le même appel et refuserait de choisir
-- (« Could not choose the best candidate function »). On retire donc
-- explicitement la signature à trois arguments avant de créer celle à
-- quatre. Sans effet si elle n'a jamais existé.
drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb, text);

create or replace function public.creer_demande_avec_vehicules(
  p_demande         jsonb,
  p_vehicules       jsonb default '[]'::jsonb,
  p_cle_creation    text  default null,
  p_cle_reclamation text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id            uuid;
  v_hash          text;
  v_ligne         public.clients%rowtype;
  v_rejeu         boolean := false;
  v_statut        text;
  v_colonnes      text;
  v_selection     text;
  v_charge        jsonb;
  v_element       jsonb;
  v_nb            integer := 0;
  v_numero        text;
  v_uid           uuid := auth.uid();
begin
  if p_demande is null or jsonb_typeof(p_demande) <> 'object' then
    raise exception 'Demande invalide.' using errcode = 'invalid_parameter_value';
  end if;
  if p_vehicules is null or jsonb_typeof(p_vehicules) <> 'array' then
    p_vehicules := '[]'::jsonb;
  end if;
  -- Garde-fou de volume : une demande légitime ne porte pas 200 véhicules.
  if jsonb_array_length(p_vehicules) > 50 then
    raise exception 'Trop de véhicules pour une seule demande.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Empreinte du secret de création, s'il est fourni. Un secret trop
  -- court ne prouverait rien : on l'ignore plutôt que de le croire.
  if p_cle_creation is not null and length(p_cle_creation) >= 32 then
    -- sha256() est natif depuis PostgreSQL 11 : pas de dépendance à
    -- pgcrypto, dont le schéma varie d'un projet Supabase à l'autre et
    -- serait invisible avec search_path = public, pg_temp.
    -- L'empreinte est préfixée par son usage (voir § 1 bis) : le secret
    -- de réclamation, même identique, ne produirait pas cette valeur.
    v_hash := public.empreinte_secret('creation', p_cle_creation);
  end if;

  begin
    v_id := nullif(p_demande ->> 'id', '')::uuid;
  exception when others then
    v_id := null;
  end;

  -- ---------- Le rejeu doit être PROUVÉ ----------
  -- Connaître l'identifiant ne donne AUCUN droit. Deux preuves seulement
  -- sont acceptées :
  --   * le secret de création correspond à celui enregistré ;
  --   * l'appelant est authentifié et déjà propriétaire de la ligne.
  -- Dans tous les autres cas, la ligne visée n'est ni lue, ni modifiée,
  -- ni même signalée comme existante : un identifiant neuf est tiré.
  if v_id is not null then
    select * into v_ligne from public.clients c where c.id = v_id;
    if found then
      v_rejeu := (v_hash is not null
                  and v_ligne.creation_cle_hash is not null
                  and v_ligne.creation_cle_hash = v_hash)
              or (v_uid is not null and v_ligne.auth_user_id = v_uid);
      if not v_rejeu then
        v_id := null;              -- la demande d'autrui reste intouchée
      end if;
    end if;
  end if;
  if v_id is null then
    v_id := gen_random_uuid();
    v_rejeu := false;
  end if;

  if not v_rejeu then
    -- Colonnes réellement écrites : l'INTERSECTION de la liste blanche,
    -- des colonnes qui existent vraiment, et des clés envoyées. Tout le
    -- reste est ignoré en silence — y compris une clé inventée.
    select string_agg(quote_ident(c.column_name), ', ' order by c.column_name),
           string_agg('r.' || quote_ident(c.column_name), ', ' order by c.column_name)
      into v_colonnes, v_selection
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name   = 'clients'
       and c.column_name  = any (public.champs_publics_demande())
       and c.column_name in (select jsonb_object_keys(p_demande));

    -- Statut : imposé par le serveur, jamais accepté tel quel.
    v_statut := coalesce(p_demande ->> 'statut', 'nouveau');
    if v_statut not in ('nouveau', 'compte_cree') then
      v_statut := 'nouveau';
    end if;

    v_charge := p_demande
              || jsonb_build_object('id', v_id::text)
              || jsonb_build_object('statut', v_statut);
    if v_hash is not null then
      v_charge := v_charge || jsonb_build_object('creation_cle_hash', v_hash);
    end if;
    -- Propriétaire : TOUJOURS la session en cours, jamais la valeur
    -- envoyée par le navigateur. Un dépôt anonyme reste sans compte.
    if v_uid is null then
      v_charge := v_charge - 'auth_user_id';
    else
      v_charge := v_charge || jsonb_build_object('auth_user_id', v_uid::text);
    end if;

    execute format(
      'insert into public.clients (id, statut%s%s%s) '
      'select r.id, r.statut%s%s%s from jsonb_populate_record(null::public.clients, $1) r',
      case when v_uid is null then '' else ', auth_user_id' end,
      case when v_hash is null then '' else ', creation_cle_hash' end,
      case when v_colonnes is null then '' else ', ' || v_colonnes end,
      case when v_uid is null then '' else ', r.auth_user_id' end,
      case when v_hash is null then '' else ', r.creation_cle_hash' end,
      case when v_selection is null then '' else ', ' || v_selection end
    ) using v_charge;
  end if;

  -- Véhicules : insérés seulement s'il n'y en a pas déjà pour cette
  -- demande. Un rejeu prouvé ne duplique donc rien, et un appel non
  -- prouvé ne peut de toute façon plus viser la demande d'autrui.
  if not exists (select 1 from public.vehicules v where v.dossier_id = v_id) then
    for v_element in select * from jsonb_array_elements(p_vehicules)
    loop
      if jsonb_typeof(v_element) <> 'object' then
        continue;
      end if;

      select string_agg(quote_ident(c.column_name), ', ' order by c.column_name),
             string_agg('r.' || quote_ident(c.column_name), ', ' order by c.column_name)
        into v_colonnes, v_selection
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name   = 'vehicules'
         and c.column_name  = any (public.champs_publics_vehicule())
         and c.column_name in (select jsonb_object_keys(v_element));

      execute format(
        'insert into public.vehicules (dossier_id%s) '
        'select $2%s from jsonb_populate_record(null::public.vehicules, $1) r',
        case when v_colonnes is null then '' else ', ' || v_colonnes end,
        case when v_selection is null then '' else ', ' || v_selection end
      ) using v_element, v_id;

      v_nb := v_nb + 1;
    end loop;
  end if;

  -- Demande déposée SANS session : elle n'a pas de propriétaire. On arme
  -- alors la réclamation, pour que le client puisse la rattacher après
  -- avoir confirmé son adresse (migration 99). L'appel est conditionnel
  -- et silencieux : tant que 99 n'est pas appliquée, rien ne se passe et
  -- la création fonctionne exactement comme avant.
  --
  -- LE SECRET ARMÉ ICI EST UN AUTRE SECRET. Celui de création ne quitte
  -- jamais la page ; celui de réclamation est le seul que le navigateur
  -- conserve, et il ne sert qu'à reclamer_demande(). Les deux empreintes
  -- sont préfixées par des usages différents (§ 1 bis) : l'un ne peut
  -- pas tenir lieu de l'autre.
  if v_uid is null and not v_rejeu then
    begin
      perform public.armer_reclamation(v_id, p_cle_reclamation);
    exception when undefined_function then
      null;   -- migration 99 pas encore appliquée
    end;
  end if;

  select c.numero_client into v_numero from public.clients c where c.id = v_id;

  return jsonb_build_object(
    'id', v_id,
    'numero_client', v_numero,
    'vehicules', v_nb,
    'deja_existante', v_rejeu,
    -- Le SERVEUR dit si la demande est rattachée à un compte. Le
    -- navigateur ne peut pas le déduire : il envoie bien un
    -- auth_user_id, mais cette fonction l'ignore volontairement et
    -- n'utilise que auth.uid(). Sans cette réponse, l'écran de succès
    -- pourrait annoncer un espace client utilisable alors que la
    -- demande n'y est pas.
    'rattachee', (v_uid is not null)
  );
end $$;

comment on function public.creer_demande_avec_vehicules(jsonb, jsonb, text, text) is
  'Crée une demande et ses véhicules dans une seule transaction. '
  'Colonnes écrites : listes BLANCHES champs_publics_demande() et '
  'champs_publics_vehicule() ; toute autre clé est ignorée. Le '
  'propriétaire vient de auth.uid(), jamais du navigateur ; le statut '
  'est imposé. Un rejeu n''est reconnu que sur PREUVE : secret de '
  'création correspondant, ou propriétaire authentifié. Connaître '
  'l''identifiant d''une demande ne donne aucun droit sur elle. '
  'p_cle_reclamation est un SECOND secret, distinct du premier : il ne '
  'sert qu''à reclamer_demande() et ne permet jamais un rejeu.';

revoke all on function public.creer_demande_avec_vehicules(jsonb, jsonb, text, text) from public;
grant execute on function public.creer_demande_avec_vehicules(jsonb, jsonb, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
-- Depuis le SQL Editor, en simulant un dépôt public :
--
--   select public.creer_demande_avec_vehicules(
--     jsonb_build_object('numero_client','TEST-QA-92','email','qa@helixcar.test',
--                        'type_service','convoyage'),
--     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA')),
--     repeat('q', 48),
--     repeat('r', 48)
--   );
--
-- Et vérifier qu'il n'existe QU'UNE signature, sans quoi PostgREST
-- refuserait de choisir :
--
--   select count(*) from pg_proc
--    where proname = 'creer_demande_avec_vehicules';
--   -- attendu : 1
--
-- Puis supprimer la ligne d'essai :
--   delete from public.clients where numero_client = 'TEST-QA-92';
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb, text, text);
--   drop function if exists public.champs_publics_demande();
--   drop function if exists public.champs_publics_vehicule();
--   drop function if exists public.empreinte_secret(text, text);
--
-- Laisser clients.creation_cle_hash en place : la colonne est vide de
-- toute donnée personnelle et son retrait casserait les rejeux en cours.
--
-- Le formulaire public de la version précédente redeviendrait celui qui
-- échoue sur les véhicules : ne retirer cette fonction que si l'ancienne
-- version du site est remise en ligne en même temps.
