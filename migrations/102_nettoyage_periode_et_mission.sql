-- ============================================================
-- HelixCar — 102 : période de nettoyage, et une mission unique
-- ============================================================
-- Dépend de : 96_missions_nettoyage.sql, 97_missions_verrou_serveur.sql,
--             101_informations_types_coherents.sql
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : une colonne nullable, un index d'unicité et une
-- fonction. Aucune donnée modifiée, aucune RLS désactivée, aucun bucket
-- ouvert. Les migrations 92 à 99 ne sont pas retouchées.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT
-- ------------------------------------------------------------
--   1. Le formulaire de nettoyage ne demandait qu'UNE date. Une
--      prestation sur flotte s'étale sur plusieurs jours : la mission
--      doit porter une période, pas un instant.
--
--   2. La mission se créait à la main, par un bouton. Deux clics, un
--      rechargement au mauvais moment, un rejeu : rien n'empêchait
--      structurellement deux missions pour la même demande. Rien non
--      plus ne vérifiait, côté serveur, que le devis avait bien été
--      accepté ni que les informations nécessaires étaient réunies.
--
-- ------------------------------------------------------------
-- 1. LA PÉRIODE D'INTERVENTION
-- ------------------------------------------------------------
alter table public.missions
  add column if not exists date_fin_intervention date;

comment on column public.missions.date_fin_intervention is
  'Dernier jour de l''intervention de nettoyage. NULL pour les missions '
  'd''un seul jour et pour celles créées avant cette migration : '
  'date_intervention fait alors foi seule.';

-- ------------------------------------------------------------
-- 2. UNE SEULE MISSION DE NETTOYAGE PAR DEMANDE — STRUCTURELLEMENT
-- ------------------------------------------------------------
-- Un index UNIQUE, pas une vérification applicative : quel que soit le
-- chemin d'écriture — Dashboard, rejeu, double clic, SQL Editor — la
-- seconde insertion est refusée par la base elle-même.
--
-- Les missions annulées sont exclues : une demande dont la mission a
-- été annulée doit pouvoir en recevoir une nouvelle.
create unique index if not exists missions_nettoyage_une_par_demande
  on public.missions (client_id)
  where type_mission = 'nettoyage' and statut <> 'annulee';

-- ------------------------------------------------------------
-- 3. LA CRÉATION, DÉCIDÉE PAR LE SERVEUR
-- ------------------------------------------------------------
-- Le navigateur ne décide plus s'il faut créer une mission : il demande,
-- et le serveur tranche. Trois conditions, toutes vérifiées ici :
--
--   * l'appelant est administrateur ;
--   * un devis ACCEPTÉ existe pour cette demande — un devis refusé ou
--     simplement envoyé ne crée jamais rien ;
--   * plus aucune information n'est attendue (informations_demande).
--
-- L'appel est IDEMPOTENT : si une mission existe déjà, elle est
-- renvoyée telle quelle. Le rejouer autant de fois qu'on veut ne crée
-- jamais de doublon — et l'index ci-dessus le garantit même si cette
-- fonction était contournée.
create or replace function public.creer_mission_nettoyage_si_prete(
  p_client_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d          public.clients%rowtype;
  nd         jsonb;
  m          public.missions%rowtype;
  v_manque   integer;
  v_devis    integer;
  v_ref      text;
  v_annee    integer := extract(year from now())::integer;
  v_num      integer;
  v_contact  jsonb;
begin
  if not public.est_admin() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;

  select * into d from public.clients c where c.id = p_client_id;
  if not found or d.type_service is distinct from 'nettoyage' then
    return jsonb_build_object('ok', false, 'code', 'DEMANDE_INTROUVABLE');
  end if;

  -- Déjà créée : on la renvoie, sans rien écrire.
  select * into m
    from public.missions mm
   where mm.client_id = p_client_id
     and mm.type_mission = 'nettoyage'
     and mm.statut <> 'annulee'
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREEE',
                              'id', m.id, 'reference', m.reference);
  end if;

  -- Un devis ACCEPTÉ, sinon rien. Un devis refusé ne crée aucune mission.
  select count(*) into v_devis
    from public.devis dv
   where dv.client_id = p_client_id
     and dv.statut = 'accepte';
  if v_devis = 0 then
    return jsonb_build_object('ok', false, 'code', 'DEVIS_NON_ACCEPTE');
  end if;

  -- Plus rien d'attendu. On réutilise la SEULE source de vérité des
  -- informations nécessaires — aucune règle recopiée ici.
  select count(*) into v_manque
    from public.informations_demande(p_client_id) i
   where i.statut = 'attendue';
  if v_manque > 0 then
    return jsonb_build_object('ok', false, 'code', 'INFORMATIONS_MANQUANTES',
                              'manquantes', v_manque);
  end if;

  nd       := coalesce(d.nettoyage_details, '{}'::jsonb);
  v_contact := coalesce(nd -> 'contact_sur_place', '{}'::jsonb);

  select coalesce(max((regexp_match(mm.reference, '^HC-NET-' || v_annee || '-(\d+)$'))[1]::integer), 0)
    into v_num
    from public.missions mm
   where mm.type_mission = 'nettoyage'
     and mm.reference like 'HC-NET-' || v_annee || '-%';
  v_ref := 'HC-NET-' || v_annee || '-' || lpad((v_num + 1)::text, 4, '0');

  insert into public.missions (
    reference, type_mission, statut, client_id,
    prestation, nb_vehicules,
    adresse_intervention, code_postal_intervention, ville_intervention,
    contact_nom, contact_tel,
    date_intervention, date_fin_intervention, heure_intervention
  ) values (
    v_ref, 'nettoyage', 'en_attente', p_client_id,
    -- La prestation est LUE PAR LE PARTENAIRE : on écrit le libellé, pas
    -- la clé technique. Les libellés vivent d'ordinaire dans le
    -- navigateur (NETT_LIB_TYPE) ; le serveur, qui crée désormais la
    -- mission, doit connaître les mêmes. Une clé inconnue est recopiée
    -- telle quelle plutôt que perdue.
    case nd ->> 'type_nettoyage'
      when 'interieur'             then 'Nettoyage intérieur'
      when 'exterieur'             then 'Nettoyage extérieur'
      when 'interieur_exterieur'   then 'Nettoyage intérieur et extérieur'
      when 'preparation_complete'  then 'Préparation complète — intérieur et extérieur'
      when 'conseil'               then 'Client à conseiller'
      else nullif(btrim(coalesce(nd ->> 'type_nettoyage', '')), '')
    end,
    nullif(btrim(coalesce(nd ->> 'nombre_vehicules_approx', '')), '')::integer,
    coalesce(nullif(btrim(coalesce(nd ->> 'adresse_rue', '')), ''),
             case when nd ->> 'lieu' = 'helixcar' then 'Locaux HelixCar' end),
    nullif(btrim(coalesce(nd ->> 'adresse_cp', '')), ''),
    nullif(btrim(coalesce(nd ->> 'adresse_ville', '')), ''),
    nullif(btrim(coalesce(v_contact ->> 'nom', '')), ''),
    nullif(btrim(coalesce(v_contact ->> 'telephone', '')), ''),
    nullif(btrim(coalesce(nd ->> 'date_souhaitee', '')), '')::date,
    nullif(btrim(coalesce(nd ->> 'date_fin', '')), '')::date,
    nullif(btrim(
      coalesce(nd ->> 'creneau_debut', '')
      || case when coalesce(nd ->> 'creneau_fin', '') <> '' then ' – ' || (nd ->> 'creneau_fin') else '' end
    ), '')
  )
  returning * into m;

  return jsonb_build_object('ok', true, 'code', 'CREEE',
                            'id', m.id, 'reference', m.reference);
exception
  -- Course entre deux appels simultanés : l'index unique tranche, et
  -- l'appel perdant renvoie la mission gagnante plutôt qu'une erreur.
  when unique_violation then
    select * into m
      from public.missions mm
     where mm.client_id = p_client_id
       and mm.type_mission = 'nettoyage'
       and mm.statut <> 'annulee'
     limit 1;
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREEE',
                              'id', m.id, 'reference', m.reference);
end $$;

comment on function public.creer_mission_nettoyage_si_prete(uuid) is
  'Crée la mission de nettoyage d''une demande, et une seule. Exige un '
  'appelant administrateur, un devis ACCEPTÉ, et aucune information '
  'encore attendue. Idempotente : un second appel renvoie la mission '
  'existante. L''index unique missions_nettoyage_une_par_demande '
  'garantit l''unicité même si cette fonction était contournée.';

revoke all on function public.creer_mission_nettoyage_si_prete(uuid) from public;
grant execute on function public.creer_mission_nettoyage_si_prete(uuid) to authenticated;
-- PAS à `anon` : créer une mission suppose une session administrateur.

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from information_schema.columns
--    where table_name='missions' and column_name='date_fin_intervention';
--   -- attendu : 1
--
--   select count(*) from pg_indexes
--    where indexname = 'missions_nettoyage_une_par_demande';
--   -- attendu : 1
--
--   select count(*) from information_schema.role_routine_grants
--    where routine_name='creer_mission_nettoyage_si_prete' and grantee='anon';
--   -- attendu : 0
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- Du moins destructeur au plus destructeur :
--
--   1. ne rien faire : cette migration n'ajoute que des garanties ;
--   2. retirer la fonction, en gardant l'unicité :
--        drop function if exists public.creer_mission_nettoyage_si_prete(uuid);
--      la création manuelle depuis le Dashboard redevient le seul chemin ;
--   3. retirer l'index d'unicité :
--        drop index if exists public.missions_nettoyage_une_par_demande;
--      ATTENTION : plus rien n'empêche alors DEUX missions pour la même
--      demande ;
--   4. retirer la colonne de période :
--        alter table public.missions drop column if exists date_fin_intervention;
--      DESTRUCTIF : les dates de fin déjà saisies seraient perdues. À ne
--      faire que si l'on renonce définitivement à la période.
