-- ============================================================
-- HelixCar — 97 : ce qu'un partenaire a le droit de changer
-- ============================================================
-- Dépend de : 90_durcissement_rls_partenaires.sql, 96_missions_nettoyage.sql
-- Idempotent : peut être rejoué sans effet de bord.
--
-- ------------------------------------------------------------
-- LE DÉFAUT
-- ------------------------------------------------------------
-- La policy « missions : mise a jour partenaire actif » (migration 90)
-- autorise un partenaire à modifier une mission qui lui est attribuée,
-- ou qui n'est attribuée à personne. Son WITH CHECK vérifie une seule
-- chose : que l'appelant est un partenaire actif.
--
--     with check (public.partenaire_actif())
--
-- Autrement dit : QUELLE COLONNE il modifie n'est jamais regardé. Le
-- Dashboard ne propose que deux boutons, mais un partenaire n'est pas
-- obligé de passer par le Dashboard : une requête PATCH directe sur
-- l'API REST, avec son propre jeton de session, suffit à
--
--     * changer le prix TTC d'une mission ;
--     * la rattacher à un autre client ;
--     * s'attribuer une mission déjà prise par un collègue ;
--     * la passer directement en « terminee » ;
--     * cocher lui-même la validation de paiement.
--
-- Limiter les boutons de l'interface ne protège rien : l'API est
-- publique, et c'est elle qu'il faut fermer.
--
-- ------------------------------------------------------------
-- LA CORRECTION
-- ------------------------------------------------------------
-- Un trigger BEFORE UPDATE, qui s'applique à TOUT chemin d'écriture —
-- REST, RPC, SQL Editor — et pas seulement à celui du Dashboard.
--
-- Principe : LISTE BLANCHE. Un partenaire ne peut toucher qu'un petit
-- nombre de colonnes ; tout le reste doit rester rigoureusement
-- identique. Une colonne ajoutée demain est donc fermée d'office.

-- ------------------------------------------------------------
-- 1. Colonnes qu'un partenaire peut modifier
-- ------------------------------------------------------------
create or replace function public.champs_partenaire_mission()
returns text[] language sql immutable
as $$
  select array[
    'convoyeur_id',                 -- uniquement pour PRENDRE une mission libre
    'statut',                       -- uniquement selon les transitions permises
    'lettre_voiture_signee_url',    -- pièce déposée par le partenaire
    'lettre_voiture_signee_date',
    'updated_at'
  ]::text[];
$$;

comment on function public.champs_partenaire_mission() is
  'Liste BLANCHE des colonnes de public.missions qu''un partenaire peut '
  'modifier. Toute autre colonne — prix, client, validation, paiement, '
  'et toute colonne ajoutée plus tard — lui est fermée.';

-- ------------------------------------------------------------
-- 2. Transitions de statut permises à un partenaire
-- ------------------------------------------------------------
create or replace function public.transition_partenaire_permise(
  p_avant text, p_apres text
) returns boolean language sql immutable
as $$
  select (p_avant, p_apres) in (
    ('en_attente',            'acceptee'),
    ('proposee',              'acceptee'),
    ('acceptee',              'en_cours'),
    ('acceptee',              'fini'),           -- nettoyage : pas d'étape intermédiaire
    ('en_cours',              'fini'),
    ('en_cours',              'restitution_requise'),
    ('restitution_requise',   'restitution_en_cours'),
    ('restitution_en_cours',  'edl_termine'),
    ('edl_termine',           'fini')
  );
$$;

comment on function public.transition_partenaire_permise(text, text) is
  'Transitions de statut qu''un partenaire peut provoquer. « terminee » '
  'et « annulee » en sont volontairement absents : ils appartiennent à '
  'l''administrateur.';

-- ------------------------------------------------------------
-- 3. Constat des photos : une prestation ne se déclare pas finie
--    sans preuve, et la preuve se vérifie EN BASE
-- ------------------------------------------------------------
create or replace function public.mission_photos_completes(p_mission_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.mission_photos p
                  where p.mission_id = p_mission_id and p.etape = 'avant')
     and exists (select 1 from public.mission_photos p
                  where p.mission_id = p_mission_id and p.etape = 'apres');
$$;

comment on function public.mission_photos_completes(uuid) is
  'Vrai si la mission porte au moins une photo avant ET une photo après, '
  'réellement enregistrées. Le Dashboard grise son bouton, mais c''est '
  'CE contrôle qui fait foi : l''API REST ne passe pas par le bouton.';

revoke all on function public.mission_photos_completes(uuid) from public;
grant execute on function public.mission_photos_completes(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Le verrou
-- ------------------------------------------------------------
create or replace function public.verrou_maj_mission()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_admin      boolean;
  v_conv       uuid;
  v_colonne    text;
  v_avant      jsonb := to_jsonb(old);
  v_apres      jsonb := to_jsonb(new);
  v_permises   text[] := public.champs_partenaire_mission();
begin
  -- Aucune session : maintenance SQL, migration, tâche de fond. Le
  -- trigger ne s'y substitue pas — c'est la RLS qui filtre l'accès.
  if v_uid is null then
    return new;
  end if;

  select public.est_admin() into v_admin;

  -- ---------- Règles qui valent AUSSI pour l'administrateur ----------
  -- Une prestation de nettoyage ne peut être validée sans que ses
  -- photos existent réellement. Le contrôle visuel dans le Dashboard
  -- n'est pas une preuve : celui-ci l'est.
  if new.type_mission = 'nettoyage'
     and new.statut = 'terminee' and old.statut is distinct from 'terminee'
     and not public.mission_photos_completes(new.id) then
    raise exception 'Prestation non constatée : il manque une photo avant ou après.'
      using errcode = 'check_violation';
  end if;

  -- Le validateur est constaté par le serveur, jamais déclaré par
  -- l'appelant : personne ne signe à la place d'un autre.
  if new.prestation_validee_le is distinct from old.prestation_validee_le
     and new.prestation_validee_le is not null then
    new.prestation_validee_par := v_uid;
  end if;

  if v_admin then
    return new;
  end if;

  -- ---------- À partir d'ici : l'appelant n'est PAS administrateur ----------
  select c.id into v_conv
    from public.convoyeurs c
   where c.auth_user_id = v_uid and coalesce(c.bloque, false) = false;

  if v_conv is null then
    raise exception 'Modification de mission non autorisée.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 4.1 Aucune colonne hors liste blanche ne bouge.
  for v_colonne in select jsonb_object_keys(v_apres)
  loop
    if not (v_colonne = any (v_permises))
       and (v_apres -> v_colonne) is distinct from (v_avant -> v_colonne) then
      raise exception 'Champ « % » réservé à HelixCar.', v_colonne
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- 4.2 L'attribution : on PREND une mission libre, on ne se l'arrache pas.
  if new.convoyeur_id is distinct from old.convoyeur_id then
    if old.convoyeur_id is not null then
      raise exception 'Cette mission est déjà attribuée.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.convoyeur_id is distinct from v_conv then
      raise exception 'Une mission ne peut être attribuée qu''à soi-même.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- 4.3 Après cette mise à jour, la mission doit être la sienne.
  if new.convoyeur_id is distinct from v_conv then
    raise exception 'Mission d''un autre partenaire.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 4.4 Les transitions de statut sont énumérées, pas devinées.
  if new.statut is distinct from old.statut
     and not public.transition_partenaire_permise(old.statut, new.statut) then
    raise exception 'Passage de « % » à « % » non autorisé.', old.statut, new.statut
      using errcode = 'insufficient_privilege';
  end if;

  -- 4.5 Un nettoyage ne se déclare pas fini sans ses photos.
  if new.type_mission = 'nettoyage' and new.statut = 'fini'
     and old.statut is distinct from 'fini'
     and not public.mission_photos_completes(new.id) then
    raise exception 'Ajoutez au moins une photo avant et une photo après.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_verrou_maj_mission on public.missions;
create trigger trg_verrou_maj_mission
  before update on public.missions
  for each row execute function public.verrou_maj_mission();

comment on function public.verrou_maj_mission() is
  'Verrou serveur des mises à jour de missions. S''applique à TOUT '
  'chemin d''écriture — REST, RPC, SQL Editor — et pas seulement aux '
  'boutons du Dashboard.';

-- ------------------------------------------------------------
-- 5. La création d'une mission reste à HelixCar
-- ------------------------------------------------------------
-- Sans cela, un partenaire pourrait créer de toutes pièces une mission
-- déjà à son nom et au prix qu'il choisit, puis la faire valider.
create or replace function public.verrou_creation_mission()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.est_admin() then
    return new;
  end if;
  raise exception 'La création d''une mission est réservée à HelixCar.'
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists trg_verrou_creation_mission on public.missions;
create trigger trg_verrou_creation_mission
  before insert on public.missions
  for each row execute function public.verrou_creation_mission();

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select tgname from pg_trigger
--    where tgrelid = 'public.missions'::regclass and not tgisinternal;
--   -- attendu : trg_verrou_maj_mission, trg_verrou_creation_mission
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   drop trigger  if exists trg_verrou_maj_mission on public.missions;
--   drop trigger  if exists trg_verrou_creation_mission on public.missions;
--   drop function if exists public.verrou_maj_mission();
--   drop function if exists public.verrou_creation_mission();
--   drop function if exists public.transition_partenaire_permise(text, text);
--   drop function if exists public.champs_partenaire_mission();
--   drop function if exists public.mission_photos_completes(uuid);
--
-- Aucune donnée n'est perdue : ces objets ne font que contrôler.
