-- ============================================================
-- HelixCar — 100 : les activités que le formulaire propose réellement
-- ============================================================
-- Dépend de : 04_decisions_activites.sql, 95_metiers_partenaires.sql
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : aucune donnée n'est modifiée ni supprimée,
-- aucune RLS n'est désactivée, aucun bucket n'est ouvert.
--
-- Les migrations 92 à 99 sont DÉJÀ APPLIQUÉES en production : aucune
-- n'est retouchée ici. Tout passe par ce nouveau fichier.
--
-- ------------------------------------------------------------
-- LE DÉFAUT, TEL QU'IL SE MANIFESTE
-- ------------------------------------------------------------
--   code 23514
--   new row for relation "convoyeurs" violates check constraint
--   "convoyeurs_activites_valides"
--
-- Aucune candidature ne peut plus être enregistrée dès que le candidat
-- retient un métier de la famille Technicien.
--
-- ------------------------------------------------------------
-- LA CAUSE
-- ------------------------------------------------------------
-- La migration 95 a introduit une quatrième activité, 'technicien',
-- portée par trois métiers : mécanique, carrosserie, diagnostic. Elle a
-- bien élargi la contrainte d'énumération de convoyeur_decisions.activite.
--
-- Mais il en existe une SECONDE, sur public.convoyeurs.activites,
-- créée bien avant ce dépôt et présente dans AUCUN fichier de
-- migrations/. Elle n'énumérait que trois valeurs. Personne ne l'a
-- élargie, et aucun test ne la voyait — le socle de tests ne la
-- reproduisait pas non plus. Elle a donc rejeté chaque candidature
-- portant l'activité 'technicien'.
--
-- Le socle de tests la déclare désormais (tests/pg/00_socle_supabase.sql) :
-- la reproduction est faite avant le correctif, pas après.
--
-- ------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ------------------------------------------------------------
-- Elle n'élargit pas la contrainte « à tout hasard ». Une valeur
-- inconnue, ancienne, vide ou forgée reste refusée. Les quatre valeurs
-- acceptées sont exactement celles que le formulaire peut produire.

-- ------------------------------------------------------------
-- 1. LA SOURCE DE VÉRITÉ, ÉCRITE UNE SEULE FOIS
-- ------------------------------------------------------------
-- Trois endroits devaient s'accorder et ne s'accordaient pas : le
-- navigateur (METIERS_PARTENAIRE), la contrainte de convoyeurs, celle
-- de convoyeur_decisions. Cette fonction devient la référence citable,
-- et un test compare les trois à elle.
create or replace function public.activites_partenaire()
returns text[]
language sql
immutable
as $$
  select array['convoyage', 'nettoyage', 'renfort', 'technicien']::text[]
$$;

comment on function public.activites_partenaire() is
  'Les SEULES activités qu''une candidature peut porter. Source de '
  'vérité citée par les contraintes de public.convoyeurs et de '
  'public.convoyeur_decisions, et comparée au formulaire par les tests. '
  'Toute autre valeur — ancienne, vide, inconnue ou forgée — est refusée.';

-- ------------------------------------------------------------
-- 2. LA CONTRAINTE DE convoyeurs.activites, ÉLARGIE AVEC PRÉCISION
-- ------------------------------------------------------------
-- Même discipline que la migration 95 : on ne supprime que ce qu'on a
-- formellement reconnu. Sont visées les contraintes CHECK portant sur
-- la SEULE colonne `activites` et énumérant les trois valeurs
-- historiques. Tout le reste est laissé en place, avec une trace.
do $$
declare
  c        record;
  v_def    text;
  v_trouve boolean := false;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join lateral unnest(con.conkey) as k(attnum) on true
      join pg_attribute a
        on a.attrelid = con.conrelid and a.attnum = k.attnum
     where con.conrelid = 'public.convoyeurs'::regclass
       and con.contype  = 'c'
       and array_length(con.conkey, 1) = 1
       and a.attname = 'activites'
  loop
    v_def := c.def;
    if v_def ilike '%convoyage%' and v_def ilike '%nettoyage%' and v_def ilike '%renfort%' then
      execute format('alter table public.convoyeurs drop constraint %I', c.conname);
      v_trouve := true;
    else
      raise notice
        'Contrainte % laissée en place (hors périmètre de cette migration) : %',
        c.conname, v_def;
    end if;
  end loop;

  if not v_trouve then
    raise notice
      'Aucune contrainte d''énumération sur convoyeurs.activites trouvée : '
      'la contrainte à jour est simplement ajoutée.';
  end if;

  -- Idempotence : au rejeu, la contrainte posée par cette migration ne
  -- cite plus les trois valeurs en clair — elle appelle une fonction —
  -- donc la boucle ci-dessus ne la reconnaît pas et ne la retire pas.
  -- On la retire donc explicitement, par son nom, avant de la reposer.
  alter table public.convoyeurs
    drop constraint if exists convoyeurs_activites_valides;

  -- NULL reste accepté : les candidatures antérieures à la colonne ne
  -- doivent pas devenir invalides. Un tableau VIDE, en revanche, ne dit
  -- rien de ce que la personne sait faire : il est refusé, exactement
  -- comme le formulaire le refuse déjà côté navigateur.
  --
  -- array_length d'un tableau vide vaut NULL, pas 0 : sans le coalesce,
  -- la comparaison rendrait NULL et la contrainte laisserait passer.
  alter table public.convoyeurs
    add constraint convoyeurs_activites_valides
    check (
      activites is null
      or (coalesce(array_length(activites, 1), 0) >= 1
          and activites <@ public.activites_partenaire())
    );
end $$;

-- ------------------------------------------------------------
-- 3. LES MÉTIERS AUSSI SONT ÉNUMÉRÉS
-- ------------------------------------------------------------
-- La colonne convoyeurs.metiers (migration 95) n'était contrainte par
-- rien : une clé inventée y entrait sans bruit, et le Dashboard
-- affichait un métier qui n'existe pas.
create or replace function public.metiers_partenaire()
returns text[]
language sql
immutable
as $$
  select array[
    'convoyage', 'nettoyage',
    'jockey', 'accueil_preparation', 'soutien_administratif',
    'mecanique', 'carrosserie', 'diagnostic'
  ]::text[]
$$;

comment on function public.metiers_partenaire() is
  'Les métiers réellement proposés par le formulaire de candidature. '
  'Même rôle que activites_partenaire() : une seule source de vérité, '
  'comparée au navigateur par les tests.';

alter table public.convoyeurs
  drop constraint if exists convoyeurs_metiers_valides;
alter table public.convoyeurs
  add constraint convoyeurs_metiers_valides
  check (metiers is null or metiers <@ public.metiers_partenaire());

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select public.activites_partenaire();
--   -- attendu : {convoyage,nettoyage,renfort,technicien}
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.convoyeurs'::regclass and contype = 'c';
--   -- attendu : convoyeurs_activites_valides citant les 4 valeurs,
--   --           et convoyeurs_metiers_valides
--
-- Essai réel, à supprimer ensuite :
--   insert into public.convoyeurs (prenom, email, activites, metiers)
--   values ('TEST-QA-CLAUDE-POSTPR2', 'qa@helixcar.test',
--           array['technicien'], array['mecanique']);
--   delete from public.convoyeurs where prenom = 'TEST-QA-CLAUDE-POSTPR2';
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- Du moins destructeur au plus destructeur :
--
--   1. ne rien faire : cette migration n'ajoute que des autorisations
--      qui manquaient, et aucune donnée n'a été modifiée ;
--   2. retirer la seule contrainte des métiers :
--        alter table public.convoyeurs
--          drop constraint if exists convoyeurs_metiers_valides;
--   3. revenir à l'énumération à trois valeurs :
--        alter table public.convoyeurs
--          drop constraint if exists convoyeurs_activites_valides;
--        alter table public.convoyeurs
--          add constraint convoyeurs_activites_valides
--          check (activites is null
--                 or activites <@ array['convoyage','nettoyage','renfort']::text[]);
--      ATTENTION : cela REBLOQUE toute candidature de technicien, et
--      les lignes déjà enregistrées avec 'technicien' feraient échouer
--      l'ajout de la contrainte. C'est le retour arrière le plus
--      destructeur : à ne faire qu'après les avoir traitées.
--
-- Les fonctions activites_partenaire() et metiers_partenaire() ne
-- peuvent être supprimées qu'après les contraintes qui les citent.
