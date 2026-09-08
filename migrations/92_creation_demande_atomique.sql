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
-- Ce qu'elle NE fait PAS, volontairement :
--   * elle n'accorde aucune policy d'écriture supplémentaire ;
--   * elle n'utilise jamais la clé service_role ;
--   * elle ne laisse pas le navigateur choisir le propriétaire, le
--     statut, ni aucune colonne administrative.

create or replace function public.creer_demande_avec_vehicules(
  p_demande   jsonb,
  p_vehicules jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id          uuid;
  v_existe      boolean;
  v_statut      text;
  v_colonnes    text;
  v_selection   text;
  v_filtre      jsonb := '{}'::jsonb;
  v_cle         text;
  v_element     jsonb;
  v_nb          integer := 0;
  v_numero      text;
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

  -- Identifiant fourni par le navigateur. Il rend l'appel REJOUABLE :
  -- une reprise après coupure ne crée pas de doublon.
  begin
    v_id := nullif(p_demande ->> 'id', '')::uuid;
  exception when others then
    v_id := null;
  end;
  if v_id is null then
    v_id := gen_random_uuid();
  end if;

  select exists (select 1 from public.clients c where c.id = v_id) into v_existe;

  if not v_existe then
    -- Colonnes réellement écrites : celles qui existent sur
    -- public.clients ET que le navigateur a envoyées, MOINS celles
    -- qu'il ne doit jamais fixer lui-même. Le filtre par motif couvre
    -- les colonnes administratives présentes ou à venir, sans avoir à
    -- maintenir une liste figée.
    select string_agg(quote_ident(c.column_name), ', ' order by c.column_name),
           string_agg('r.' || quote_ident(c.column_name), ', ' order by c.column_name)
      into v_colonnes, v_selection
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name   = 'clients'
       and c.column_name in (select jsonb_object_keys(p_demande))
       and c.column_name not in ('id', 'auth_user_id', 'statut', 'created_at', 'updated_at')
       and c.column_name !~* '(prix|montant|paye|paiement|devis|valide|bloque|admin|interne|remuneration|commission|marge)';

    -- Statut : imposé par le serveur, jamais accepté tel quel.
    v_statut := coalesce(p_demande ->> 'statut', 'nouveau');
    if v_statut not in ('nouveau', 'compte_cree') then
      v_statut := 'nouveau';
    end if;

    v_filtre := p_demande
              || jsonb_build_object('id', v_id::text)
              || jsonb_build_object('statut', v_statut);
    -- Propriétaire : TOUJOURS la session en cours, jamais la valeur
    -- envoyée par le navigateur. Un dépôt anonyme reste sans compte.
    if auth.uid() is null then
      v_filtre := v_filtre - 'auth_user_id';
    else
      v_filtre := v_filtre || jsonb_build_object('auth_user_id', auth.uid()::text);
    end if;

    execute format(
      'insert into public.clients (id, statut%s%s) '
      'select r.id, r.statut%s%s from jsonb_populate_record(null::public.clients, $1) r',
      case when auth.uid() is null then '' else ', auth_user_id' end,
      case when v_colonnes is null then '' else ', ' || v_colonnes end,
      case when auth.uid() is null then '' else ', r.auth_user_id' end,
      case when v_selection is null then '' else ', ' || v_selection end
    ) using v_filtre;
  end if;

  -- Véhicules : insérés seulement s'il n'y en a pas déjà pour cette
  -- demande. Un rejeu ne duplique donc rien.
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
         and c.column_name in (select jsonb_object_keys(v_element))
         and c.column_name not in ('id', 'dossier_id', 'created_at', 'updated_at');

      execute format(
        'insert into public.vehicules (dossier_id%s) '
        'select $2%s from jsonb_populate_record(null::public.vehicules, $1) r',
        case when v_colonnes is null then '' else ', ' || v_colonnes end,
        case when v_selection is null then '' else ', ' || v_selection end
      ) using v_element, v_id;

      v_nb := v_nb + 1;
    end loop;
  end if;

  select c.numero_client into v_numero from public.clients c where c.id = v_id;

  return jsonb_build_object(
    'id', v_id,
    'numero_client', v_numero,
    'vehicules', v_nb,
    'deja_existante', v_existe
  );
end $$;

comment on function public.creer_demande_avec_vehicules(jsonb, jsonb) is
  'Crée une demande et ses véhicules dans une seule transaction. '
  'Le propriétaire vient de auth.uid(), jamais du navigateur ; le statut '
  'est imposé ; les colonnes administratives sont ignorées. Rejouable '
  'grâce à l''identifiant fourni : une reprise ne duplique rien.';

revoke all on function public.creer_demande_avec_vehicules(jsonb, jsonb) from public;
grant execute on function public.creer_demande_avec_vehicules(jsonb, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
-- Depuis le SQL Editor, en simulant un dépôt public :
--
--   select public.creer_demande_avec_vehicules(
--     jsonb_build_object('numero_client','TEST-QA-92','email','qa@helixcar.test',
--                        'type_service','convoyage'),
--     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA'))
--   );
--
-- Puis supprimer la ligne d'essai :
--   delete from public.clients where numero_client = 'TEST-QA-92';
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb);
--
-- Le formulaire public de la version précédente redeviendrait alors
-- celui qui échoue sur les véhicules : ne retirer cette fonction que si
-- l'ancienne version du site est remise en ligne en même temps.
