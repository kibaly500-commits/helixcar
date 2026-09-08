-- ============================================================
-- HelixCar — 95 : métiers déclarés par les partenaires
-- ============================================================
-- Dépend de : 04_decisions_activites.sql
-- Idempotent : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : aucune donnée existante n'est modifiée ni
-- supprimée, aucune RLS n'est désactivée, aucun bucket n'est ouvert.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT
-- ------------------------------------------------------------
-- Un client peut demander un TECHNICIEN automobile (mécanique,
-- carrosserie, diagnostic) ou un RENFORT sur site pour une mission
-- précise (jockey, accueil en concession, soutien administratif).
-- Or le formulaire de candidature n'offrait que trois cases —
-- convoyage, nettoyage, renfort — sans aucun métier :
--
--   * aucun candidat ne pouvait se déclarer technicien : HelixCar
--     n'avait donc, structurellement, personne à proposer pour une
--     demande de technicien ;
--   * un candidat « renfort » ne pouvait pas dire QUELLES missions il
--     sait tenir, ni un technicien ses spécialités. Le rapprochement
--     entre une demande et un partenaire restait manuel et approximatif.
--
-- ------------------------------------------------------------
-- CE QUE FAIT CETTE MIGRATION
-- ------------------------------------------------------------
--   1. convoyeurs.metiers : les métiers réellement déclarés, en plus
--      des activités (qui restent la granularité des décisions).
--   2. l'activité 'technicien' devient une valeur acceptée par
--      convoyeur_decisions, exactement comme les trois autres.
--
-- Les libellés ne sont PAS stockés en base : ils vivent dans le
-- navigateur (PRO_LIB_SPECIALITE / PRO_LIB_MISSION), déjà partagés
-- entre le formulaire client et le Dashboard. Seules les CLÉS sont
-- enregistrées — celles-là mêmes que le formulaire client utilise déjà.

-- ------------------------------------------------------------
-- 1. Métiers déclarés
-- ------------------------------------------------------------
alter table public.convoyeurs
  add column if not exists metiers text[];

comment on column public.convoyeurs.metiers is
  'Métiers réellement déclarés par le partenaire, au sein de ses '
  'activités : jockey, accueil_preparation, soutien_administratif '
  '(renfort) ; mecanique, carrosserie, diagnostic (technicien). '
  'NULL ou tableau vide pour les candidatures antérieures — elles '
  'restent valides et ne sont jamais modifiées ici.';

create index if not exists convoyeurs_metiers_idx
  on public.convoyeurs using gin (metiers);

-- ------------------------------------------------------------
-- 2. 'technicien' devient une activité comme les autres
-- ------------------------------------------------------------
-- La contrainte de 04 n'acceptait que trois valeurs. Elle est
-- remplacée, jamais supprimée sans remplaçante : aucune ligne ne peut
-- se retrouver, même une fraction de seconde, sans contrôle.
--
-- DÉFAUT CORRIGÉ. Une version précédente cherchait « toute contrainte
-- CHECK dont la définition contient le mot activite » :
--
--     pg_get_constraintdef(oid) ilike '%activite%'
--
-- C'était beaucoup trop large. Une contrainte sans aucun rapport —
-- « check (activite_secondaire is not null) », « check (char_length(
-- activite_libelle) < 60) » — aurait été supprimée au passage, et
-- jamais remise. Une migration ne doit pas détruire ce qu'elle n'a pas
-- reconnu.
--
-- La cible est donc identifiée précisément : une contrainte
-- d'ÉNUMÉRATION portant sur la colonne `activite` seule, contenant les
-- trois valeurs de 04. Sa définition est vérifiée AVANT le
-- remplacement, et tout ce qui ne correspond pas est laissé en place.
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
     where con.conrelid = 'public.convoyeur_decisions'::regclass
       and con.contype  = 'c'
       -- La contrainte ne porte QUE sur la colonne activite.
       and array_length(con.conkey, 1) = 1
       and a.attname = 'activite'
  loop
    v_def := c.def;
    -- Et c'est bien une énumération des trois valeurs de 04. Une
    -- contrainte de longueur, de format ou de nullité ne l'est pas.
    if v_def ilike '%convoyage%' and v_def ilike '%nettoyage%' and v_def ilike '%renfort%' then
      execute format('alter table public.convoyeur_decisions drop constraint %I', c.conname);
      v_trouve := true;
    else
      raise notice
        'Contrainte % laissée en place (hors périmètre de cette migration) : %',
        c.conname, v_def;
    end if;
  end loop;

  if not v_trouve then
    raise notice
      'Aucune contrainte d''énumération sur convoyeur_decisions.activite '
      'trouvée : la contrainte élargie est simplement ajoutée.';
  end if;

  -- Idempotence : un rejeu retrouve et retire sa propre contrainte à
  -- l'itération précédente, puisqu'elle énumère bien les trois valeurs.
  alter table public.convoyeur_decisions
    add constraint convoyeur_decisions_activite_check
    check (activite in ('convoyage', 'nettoyage', 'renfort', 'technicien'));
end $$;

-- Décisions manquantes pour les partenaires qui déclarent déjà une
-- activité non couverte : créées en 'en_attente', jamais en 'oui'.
-- Aucune acceptation automatique — c'est exactement la règle de 04.
insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
select c.id, a, 'en_attente'
  from public.convoyeurs c
  cross join lateral unnest(coalesce(c.activites, '{}')) as a
 where a in ('convoyage', 'nettoyage', 'renfort', 'technicien')
on conflict (convoyeur_id, activite) do nothing;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select column_name from information_schema.columns
--    where table_name = 'convoyeurs' and column_name = 'metiers';
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'convoyeur_decisions_activite_check';
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- La colonne metiers doit être LAISSÉE EN PLACE : elle est nullable et
-- la version précédente de l'application l'ignore purement et
-- simplement. La retirer supprimerait des informations réellement
-- déclarées par des candidats.
--
-- Pour revenir à la contrainte d'origine — uniquement si plus AUCUNE
-- ligne ne porte l'activité 'technicien' :
--
--   select count(*) from public.convoyeur_decisions where activite = 'technicien';
--   -- si 0 :
--   alter table public.convoyeur_decisions
--     drop constraint convoyeur_decisions_activite_check;
--   alter table public.convoyeur_decisions
--     add constraint convoyeur_decisions_activite_check
--     check (activite in ('convoyage', 'nettoyage', 'renfort'));
--
-- Si des lignes 'technicien' existent, les supprimer d'abord
-- supprimerait de vraies décisions administrateur : ne pas revenir en
-- arrière dans ce cas.
