-- ============================================================
-- HelixCar — 99 : rattacher sa demande après confirmation d'e-mail
-- ============================================================
-- Dépend de : 92_creation_demande_atomique.sql, 06_informations_manquantes.sql
-- Idempotent : peut être rejoué sans effet de bord.
--
-- ------------------------------------------------------------
-- LE DÉFAUT
-- ------------------------------------------------------------
-- Chez Supabase, la confirmation d'e-mail est active par défaut. Dans ce
-- cas, signUp() renvoie un utilisateur mais AUCUNE session : l'appel qui
-- suit reste anonyme, et creer_demande_avec_vehicules() écrit donc la
-- demande avec auth_user_id = NULL. C'est volontaire — le propriétaire
-- vient de auth.uid(), jamais du navigateur.
--
-- L'écran de succès annonçait alors :
--
--     « elle apparaîtra dans votre espace une fois votre adresse
--       confirmée »
--
-- CE COMPORTEMENT N'EXISTAIT PAS. Aucune fonction, aucun trigger, aucun
-- RPC ne rattachait la demande après confirmation. Reproduit sur
-- PostgreSQL 16 (tests/t_rls.sh, section R) : après confirmation et
-- ouverture de session, v_mes_demandes renvoie zéro ligne, et
-- auth_user_id vaut toujours NULL.
--
-- Une promesse faite à l'écran et non tenue par le code est un défaut au
-- même titre qu'un calcul faux.
--
-- ------------------------------------------------------------
-- POURQUOI PAS UN RATTACHEMENT PAR E-MAIL
-- ------------------------------------------------------------
-- La solution évidente — « à la première connexion, rattacher toutes
-- les demandes portant la même adresse » — est précisément celle que
-- 06_informations_manquantes.sql refuse, et pour une bonne raison : une
-- adresse peut être ressaisie, mal orthographiée, partagée en famille ou
-- en entreprise. Rattacher sur ce seul critère donnerait à quelqu'un les
-- demandes d'un autre.
--
-- L'adresse reste donc une CONDITION, jamais une PREUVE.
--
-- ------------------------------------------------------------
-- CE QUI EST EXIGÉ POUR RÉCLAMER UNE DEMANDE
-- ------------------------------------------------------------
-- Six conditions, toutes nécessaires, aucune suffisante :
--
--   1. une session authentifiée (auth.uid() non nul) ;
--   2. une adresse RÉELLEMENT confirmée (auth.users.email_confirmed_at) ;
--   3. l'adresse vérifiée du compte égale celle portée par la demande ;
--   4. l'identifiant exact de la demande ;
--   5. un secret aléatoire, dont seule l'empreinte SHA-256 est en base ;
--   6. ce secret encore valide — il expire.
--
-- Et après réussite, le secret est CONSOMMÉ : l'empreinte est effacée.
-- Un rejeu ne rattache donc rien une seconde fois.
--
-- L'UUID seul ne suffit pas. L'adresse seule ne suffit pas. Le secret
-- seul ne suffit pas.
--
-- ------------------------------------------------------------
-- DEUX SECRETS, ET NON UN SEUL
-- ------------------------------------------------------------
-- Une première version réutilisait ici le secret de CRÉATION de la
-- migration 92. C'était une faute, et un audit l'a relevée : ce secret
-- est une preuve de rejeu pour creer_demande_avec_vehicules(). Le
-- persister trente jours dans le navigateur revenait donc à laisser sur
-- l'appareil, à lui seul et sans aucune session, de quoi :
--
--   * rejouer la création de la demande ;
--   * en relire le numéro client ;
--   * et, si elle n'avait pas encore de véhicule, lui en greffer.
--
-- « Le secret ne donne aucun droit à lui seul » était donc faux.
--
-- Désormais le navigateur tire DEUX secrets sans rapport :
--
--   * celui de création ne quitte jamais la page — il n'est écrit nulle
--     part et meurt avec elle ;
--   * celui de réclamation est le seul conservé, et n'ouvre que
--     reclamer_demande().
--
-- La séparation ne repose pas sur le hasard : les deux empreintes sont
-- préfixées par leur usage (public.empreinte_secret, migration 92).
-- Présenter le secret de réclamation à la vérification de création ne
-- produit pas la bonne empreinte — c'est structurel, pas probabiliste.
--
-- Et au rattachement, creation_cle_hash est effacée elle aussi : la
-- demande a désormais un propriétaire, qui prouve son droit par sa
-- session. Plus aucune empreinte n'a de raison de subsister.

-- ------------------------------------------------------------
-- 1. Le secret de réclamation
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists reclamation_cle_hash  text,
  add column if not exists reclamation_expire_le timestamptz;

comment on column public.clients.reclamation_cle_hash is
  'Empreinte SHA-256 du secret permettant de réclamer cette demande '
  'après confirmation de l''adresse. Effacée dès que la demande est '
  'rattachée. Le secret lui-même n''est jamais stocké.';
comment on column public.clients.reclamation_expire_le is
  'Au-delà de cette date, le secret ne vaut plus rien.';

create index if not exists clients_reclamation_idx
  on public.clients (reclamation_cle_hash)
  where reclamation_cle_hash is not null;

-- Durée de vie du secret. Assez longue pour un client qui confirme son
-- adresse le lendemain ; assez courte pour ne pas traîner indéfiniment.
create or replace function public.duree_reclamation()
returns interval language sql immutable as $$ select interval '30 days' $$;

-- ------------------------------------------------------------
-- 2. La création dépose le secret — uniquement si nécessaire
-- ------------------------------------------------------------
-- creer_demande_avec_vehicules() reçoit un SECOND secret, distinct de
-- celui de création (paramètre p_cle_reclamation). Il n'est armé que
-- lorsque la demande part sans propriétaire : une demande déjà rattachée
-- n'a rien à réclamer, et n'a donc aucune raison de porter un secret
-- réclamable.
create or replace function public.armer_reclamation(
  p_client_id uuid,
  p_cle       text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cle is null or length(p_cle) < 32 then
    return;
  end if;
  update public.clients c
     set reclamation_cle_hash  = public.empreinte_secret('reclamation', p_cle),
         reclamation_expire_le = now() + public.duree_reclamation()
   where c.id = p_client_id
     and c.auth_user_id is null;      -- rien à réclamer si déjà rattachée
end $$;

revoke all on function public.armer_reclamation(uuid, text) from public;

-- Le déclencheur : à la création d'une demande SANS propriétaire, on
-- arme la réclamation avec le secret déjà fourni par le navigateur.
-- Passer par un trigger évite de retoucher creer_demande_avec_vehicules :
-- la migration 92 reste ce qu'elle est, et la réclamation s'ajoute par
-- dessus sans la réécrire.
--
-- Le secret n'est PAS disponible dans le trigger — il n'est connu que de
-- la fonction de création. C'est donc cette dernière qui appelle
-- armer_reclamation(), juste après l'insertion.

-- ------------------------------------------------------------
-- 3. La réclamation elle-même
-- ------------------------------------------------------------
create or replace function public.reclamer_demande(
  p_client_id uuid,
  p_cle       text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_confirme timestamptz;
  v_ligne    public.clients%rowtype;
  v_hash     text;
begin
  -- 1. Une session, sinon rien.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_REQUISE');
  end if;

  select u.email, u.email_confirmed_at
    into v_email, v_confirme
    from auth.users u where u.id = v_uid;

  -- 2. Une adresse RÉELLEMENT confirmée. Un compte créé et jamais
  --    confirmé ne réclame rien : ce serait rouvrir la porte que la
  --    confirmation est censée fermer.
  if v_confirme is null then
    return jsonb_build_object('ok', false, 'code', 'ADRESSE_NON_CONFIRMEE');
  end if;

  -- 5. Le secret, avant même de regarder la ligne.
  if p_cle is null or length(p_cle) < 32 then
    return jsonb_build_object('ok', false, 'code', 'CLE_INVALIDE');
  end if;
  -- Empreinte préfixée par son usage : ce calcul ne peut pas produire
  -- une valeur acceptée par la vérification de creation_cle_hash.
  v_hash := public.empreinte_secret('reclamation', p_cle);

  -- 4. L'identifiant exact.
  select * into v_ligne from public.clients c where c.id = p_client_id;
  if not found then
    -- Même réponse que pour un refus : ne pas révéler ce qui existe.
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
  end if;

  -- Demande déjà rattachée. Si c'est à MOI, l'appel est idempotent —
  -- une seconde ouverture de session ne doit pas produire d'erreur.
  -- Sinon, refus sec.
  if v_ligne.auth_user_id is not null then
    if v_ligne.auth_user_id = v_uid then
      return jsonb_build_object('ok', true, 'code', 'DEJA_RATTACHEE',
                                'id', v_ligne.id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
  end if;

  -- 5 bis. L'empreinte doit correspondre.
  if v_ligne.reclamation_cle_hash is null
     or v_ligne.reclamation_cle_hash <> v_hash then
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
  end if;

  -- 6. Et le secret doit encore être valide.
  if v_ligne.reclamation_expire_le is null
     or v_ligne.reclamation_expire_le <= now() then
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_EXPIREE');
  end if;

  -- 3. L'adresse vérifiée du compte est celle de la demande. C'est une
  --    CONDITION supplémentaire, pas une preuve : sans le secret, elle
  --    ne donne aucun droit.
  if v_email is null or v_ligne.email is null
     or lower(btrim(v_email)) <> lower(btrim(v_ligne.email)) then
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
  end if;

  -- Tout est réuni : on rattache, et on CONSOMME les secrets.
  --
  -- creation_cle_hash part avec le reste. Elle ne servait qu'à prouver
  -- un rejeu de création avant qu'un compte ne soit connu ; la demande a
  -- maintenant un propriétaire, qui prouve son droit par sa session
  -- (branche « v_uid is not null and auth_user_id = v_uid » de la
  -- migration 92). La garder n'apporterait rien et laisserait traîner
  -- une preuve utilisable sans session.
  update public.clients c
     set auth_user_id          = v_uid,
         reclamation_cle_hash  = null,
         reclamation_expire_le = null,
         creation_cle_hash     = null
   where c.id = p_client_id
     and c.auth_user_id is null;      -- garde-fou contre une course

  return jsonb_build_object('ok', true, 'code', 'RATTACHEE', 'id', p_client_id);
end $$;

comment on function public.reclamer_demande(uuid, text) is
  'Rattache une demande déposée anonymement au compte qui vient de '
  'confirmer son adresse. Exige TOUTES ces conditions : session, adresse '
  'confirmée, adresse identique à celle de la demande, identifiant exact, '
  'secret correspondant à l''empreinte stockée, secret non expiré. Le '
  'secret est consommé après réussite, de même que l''empreinte de '
  'création devenue inutile. Ni l''UUID seul, ni l''adresse seule, ni le '
  'secret seul ne suffisent jamais. Ce secret est DISTINCT de celui de '
  'création : il ne permet aucun rejeu.';

revoke all on function public.reclamer_demande(uuid, text) from public;
grant execute on function public.reclamer_demande(uuid, text) to authenticated;
-- PAS à `anon` : réclamer suppose une session confirmée.

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from pg_proc where proname = 'reclamer_demande';
--   -- attendu : 1
--
--   select count(*) from information_schema.role_routine_grants
--    where routine_name = 'reclamer_demande' and grantee = 'anon';
--   -- attendu : 0
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   drop function if exists public.reclamer_demande(uuid, text);
--   drop function if exists public.armer_reclamation(uuid, text);
--   drop function if exists public.duree_reclamation();
--
-- Laisser les deux colonnes en place : elles ne contiennent aucune
-- donnée personnelle, et les retirer ferait perdre les réclamations en
-- attente. Retirer ces fonctions rend en revanche de nouveau FAUSSE la
-- phrase affichée au client : retirer aussi cette phrase d'index.html.
