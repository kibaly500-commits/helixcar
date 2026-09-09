-- ============================================================
-- HelixCar — 104 : une identité, plusieurs casquettes
-- ============================================================
-- Dépend de : 00_helpers.sql, 90_durcissement_rls_partenaires.sql,
--             91_durcissement_rls_clients.sql
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : deux index d'unicité et deux fonctions. Aucune
-- donnée modifiée, aucune RLS affaiblie, aucun bucket ouvert.
--
-- LES MIGRATIONS 92 À 103 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT
-- ------------------------------------------------------------
--   1. Une même personne peut être cliente ET partenaire HelixCar.
--      L'architecture le permettait déjà — `admins`, `convoyeurs` et
--      `clients` portent chacune un `auth_user_id` — mais RIEN ne
--      l'empêchait de dériver : deux fiches partenaire pour la même
--      identité, deux lignes d'administrateur pour le même compte.
--
--   2. Aucun moyen, pour la page, de savoir QUELS rôles une identité
--      possède réellement. Le Dashboard prenait le PREMIER rôle trouvé
--      (admin, puis partenaire, puis client) et n'offrait jamais de
--      choix : une personne à deux casquettes ne pouvait pas atteindre
--      la seconde.
--
--   3. Rattacher une candidature existante à un compte Auth se faisait
--      depuis le navigateur, avec la clé anon, par un PATCH direct sur
--      `convoyeurs.auth_user_id`. Deux conséquences : la RLS refuse
--      cette écriture (PostgREST répond 204 avec ZÉRO ligne modifiée,
--      donc le rattachement n'avait jamais lieu), et si elle
--      l'acceptait, n'importe qui aurait pu s'attribuer la fiche d'un
--      autre en connaissant son adresse.
--
-- ------------------------------------------------------------
-- 1. UNE SEULE FICHE PAR IDENTITÉ, GARANTIE PAR LA BASE
-- ------------------------------------------------------------
-- Index UNIQUES et PARTIELS : ils ne portent que sur les lignes
-- réellement rattachées à un compte. Les candidatures déposées sans
-- compte (auth_user_id null) restent libres, et une candidature
-- REFUSÉE n'empêche pas de recandidater plus tard.
--
-- Posés seulement si l'existant le permet : une migration ne doit pas
-- échouer sur des données antérieures qu'elle n'a pas créées. En cas de
-- doublon préexistant, un avis est émis et l'index n'est pas créé —
-- l'administrateur tranche, jamais la migration.
do $$
declare
  n_admins integer;
  n_conv   integer;
begin
  select count(*) into n_admins from (
    select auth_user_id from public.admins
     where auth_user_id is not null
     group by auth_user_id having count(*) > 1) d;
  if n_admins = 0 then
    create unique index if not exists admins_une_ligne_par_identite
      on public.admins (auth_user_id)
      where auth_user_id is not null;
  else
    raise notice 'admins : % identite(s) en double, index non pose. A trancher a la main.', n_admins;
  end if;

  select count(*) into n_conv from (
    select auth_user_id from public.convoyeurs
     where auth_user_id is not null and statut is distinct from 'refuse'
     group by auth_user_id having count(*) > 1) d;
  if n_conv = 0 then
    create unique index if not exists convoyeurs_une_fiche_par_identite
      on public.convoyeurs (auth_user_id)
      where auth_user_id is not null and statut is distinct from 'refuse';
  else
    raise notice 'convoyeurs : % identite(s) en double, index non pose. A trancher a la main.', n_conv;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. LES RÔLES DE LA SESSION EN COURS — ET D'ELLE SEULE
-- ------------------------------------------------------------
-- La page ne devine plus rien : elle demande. La fonction ne parle QUE
-- de `auth.uid()`, jamais d'une adresse fournie par l'appelant : il est
-- donc impossible de s'en servir pour découvrir si quelqu'un d'autre a
-- un compte, ni lequel.
--
-- « client » n'a pas de table de profils : une personne est cliente dès
-- qu'une de ses demandes lui est rattachée. C'est exactement ce que
-- lit la troisième clause.
create or replace function public.roles_utilisateur()
returns table (role text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'admin'::text
   where exists (select 1 from public.admins a
                  where a.auth_user_id = auth.uid() and a.actif is true)
  union all
  select 'partenaire'::text
   where exists (select 1 from public.convoyeurs c
                  where c.auth_user_id = auth.uid()
                    and c.statut is distinct from 'refuse')
  union all
  select 'client'::text
   where exists (select 1 from public.clients cl
                  where cl.auth_user_id = auth.uid());
$$;

revoke all on function public.roles_utilisateur() from public;
grant execute on function public.roles_utilisateur() to authenticated;

comment on function public.roles_utilisateur() is
  'Rôles réellement attribués à la SESSION EN COURS. Ne renseigne '
  'jamais sur une autre identité : aucun paramètre, aucune adresse. '
  'Le rôle administrateur n''est jamais auto-attribuable — cette '
  'fonction ne fait que LIRE public.admins.';

-- ------------------------------------------------------------
-- 3. AJOUTER LE RÔLE PARTENAIRE À UNE IDENTITÉ EXISTANTE
-- ------------------------------------------------------------
-- Remplace le PATCH anonyme depuis le navigateur. Trois conditions,
-- toutes vérifiées CÔTÉ SERVEUR, et aucune ne vient de l'appelant :
--
--   * une session existe, et son adresse est CONFIRMÉE ;
--   * la candidature visée porte exactement cette adresse ;
--   * cette identité n'a pas déjà une fiche partenaire.
--
-- Le rôle administrateur n'est jamais touché : cette fonction ne sait
-- écrire que dans `convoyeurs.auth_user_id`.
--
-- Idempotente : rappelée sur une candidature déjà rattachée à SOI, elle
-- répond DEJA_RATTACHEE sans rien réécrire. Résistante au double clic
-- et aux appels concurrents : l'index d'unicité tranche, et la
-- violation est rattrapée.
create or replace function public.ajouter_role_partenaire(p_convoyeur_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_conf   timestamptz;
  v_fiche  public.convoyeurs%rowtype;
  v_deja   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTHENTIFIE');
  end if;

  select u.email, u.email_confirmed_at into v_email, v_conf
    from auth.users u where u.id = v_uid;
  if v_conf is null then
    return jsonb_build_object('ok', false, 'code', 'ADRESSE_NON_CONFIRMEE');
  end if;

  select * into v_fiche from public.convoyeurs c where c.id = p_convoyeur_id;
  -- Réponse IDENTIQUE pour « la fiche n'existe pas » et « elle ne vous
  -- appartient pas » : sans quoi, essayer des identifiants renseignerait
  -- sur l'existence des candidatures.
  if not found or lower(coalesce(v_fiche.email, '')) is distinct from lower(coalesce(v_email, '')) then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;

  if v_fiche.auth_user_id = v_uid then
    return jsonb_build_object('ok', true, 'code', 'DEJA_RATTACHEE', 'convoyeur_id', v_fiche.id);
  end if;
  if v_fiche.auth_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'DEJA_RATTACHEE_AILLEURS');
  end if;

  -- Une identité ne porte qu'UNE fiche partenaire.
  select c.id into v_deja from public.convoyeurs c
   where c.auth_user_id = v_uid and c.statut is distinct from 'refuse'
   limit 1;
  if v_deja is not null then
    return jsonb_build_object('ok', false, 'code', 'ROLE_DEJA_PRESENT', 'convoyeur_id', v_deja);
  end if;

  begin
    update public.convoyeurs set auth_user_id = v_uid where id = p_convoyeur_id;
  exception when unique_violation then
    -- Deux appels simultanés : le second constate que le premier a
    -- gagné, et ne crée surtout pas une seconde fiche.
    return jsonb_build_object('ok', false, 'code', 'ROLE_DEJA_PRESENT');
  end;

  return jsonb_build_object('ok', true, 'code', 'RATTACHEE', 'convoyeur_id', p_convoyeur_id);
end $$;

revoke all on function public.ajouter_role_partenaire(uuid) from public;
grant execute on function public.ajouter_role_partenaire(uuid) to authenticated;

comment on function public.ajouter_role_partenaire(uuid) is
  'Rattache une candidature partenaire EXISTANTE à la session en cours, '
  'si et seulement si son adresse confirmée est exactement celle de la '
  'candidature et que cette identité n''a pas déjà une fiche partenaire. '
  'Remplace le PATCH anonyme qui, lui, était refusé par la RLS.';

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from pg_indexes
--    where indexname in ('admins_une_ligne_par_identite',
--                        'convoyeurs_une_fiche_par_identite');
--   -- attendu : 2 (si 0 ou 1, relire les « notice » de l'application :
--   --              des doublons préexistants ont été signalés)
--
--   select * from public.roles_utilisateur();
--   -- exécuté depuis une session réelle : 1 à 3 lignes
--
--   select count(*) from pg_proc
--    where proname in ('roles_utilisateur','ajouter_role_partenaire');
--   -- attendu : 2 (une seule signature par nom : aucune ambiguïté
--   --              PostgREST)
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire. Ce fichier n'ajoute que des garanties.
--   2. Retirer les fonctions :
--        drop function if exists public.ajouter_role_partenaire(uuid);
--        drop function if exists public.roles_utilisateur();
--      ⚠️ Le sélecteur de Dashboard cesse alors de fonctionner, et le
--      rattachement d'un rôle partenaire redevient impossible.
--   3. Retirer les index :
--        drop index if exists public.convoyeurs_une_fiche_par_identite;
--        drop index if exists public.admins_une_ligne_par_identite;
--      ⚠️ Plus rien n'empêche alors deux fiches pour une identité.
