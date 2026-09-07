-- ============================================================
-- HelixCar — 05 : blocage partenaire — PHASE PRÉPARATOIRE
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- ⚠️ CE FICHIER EST VOLONTAIREMENT ADDITIF ET SANS RLS.
--
-- Il peut être appliqué en production ALORS QUE L'ANCIEN DASHBOARD EST
-- ENCORE EN LIGNE, sans rien vider et sans rien casser : il n'active
-- aucune Row Level Security, ne crée aucune politique, et n'installe
-- aucun garde-fou susceptible de refuser une écriture existante.
--
-- Le durcissement — activation de la RLS et politiques — vit dans un
-- fichier séparé, `90_durcissement_rls_partenaires.sql`, à appliquer
-- APRÈS le déploiement de la nouvelle interface. Voir README.md,
-- section « Déploiement en trois phases ».
--
-- POURQUOI CETTE SÉPARATION (mesuré, pas supposé) : l'ancien Dashboard
-- envoie la clé `anon` sur TOUS ses appels REST. `auth.uid()` y vaut
-- donc null. Activer la RLS pendant qu'il est en ligne produit :
--   * lectures  -> 0 ligne, en HTTP 200 : le Dashboard se vide SANS
--                  afficher la moindre erreur ;
--   * UPDATE    -> « UPDATE 0 » : l'écriture est acceptée et ne modifie
--                  RIEN. L'interface annonce un succès mensonger ;
--   * INSERT    -> rejet 42501, seule erreur réellement visible.
-- Ces trois comportements ont été observés sur un PostgreSQL 16 local
-- en appliquant ces fichiers (cf. tests/t_rls.sh).

-- ------------------------------------------------------------
-- 1. Colonnes de blocage (additif pur)
-- ------------------------------------------------------------
-- `bloque` est la source de vérité DÉJÀ utilisée par le contrôle
-- d'accès existant (finaliserSessionConvoyeur la lit pour refuser la
-- connexion). On ne crée donc aucun second champ concurrent.
alter table public.convoyeurs
  add column if not exists bloque       boolean not null default false,
  add column if not exists bloque_le    timestamptz,
  add column if not exists bloque_par   uuid references auth.users(id),
  add column if not exists bloque_motif text;

comment on column public.convoyeurs.bloque is
  'Blocage réel du partenaire. Appliqué par les politiques RLS de '
  '90_durcissement_rls_partenaires.sql, jamais par le seul affichage.';

create index if not exists convoyeurs_bloque_idx
  on public.convoyeurs (bloque) where bloque;

-- ------------------------------------------------------------
-- 2. Trace automatique du blocage
-- ------------------------------------------------------------
-- Compatible ancien Dashboard : ce trigger ne se déclenche que si
-- `bloque` change réellement de valeur. Les écritures existantes
-- (validation d'une candidature, mise à jour d'un profil) le traversent
-- sans effet et sans erreur.
create or replace function public.tracer_blocage_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.bloque is distinct from old.bloque then
    if new.bloque then
      new.bloque_le  := now();
      new.bloque_par := auth.uid();
    else
      -- Déblocage : on rétablit uniquement les autorisations prévues,
      -- sans conserver un état de blocage résiduel.
      new.bloque_le    := null;
      new.bloque_par   := null;
      new.bloque_motif := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tracer_blocage_convoyeur on public.convoyeurs;
create trigger trg_tracer_blocage_convoyeur
  before update on public.convoyeurs
  for each row execute function public.tracer_blocage_convoyeur();

-- ------------------------------------------------------------
-- 3. Fonction d'accès : un partenaire actif est un partenaire NON bloqué
-- ------------------------------------------------------------
-- Créée dès maintenant, mais utilisée seulement par les politiques de
-- la phase de durcissement. La déclarer ici n'a aucun effet visible.
create or replace function public.partenaire_actif()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.convoyeurs c
     where c.auth_user_id = auth.uid()
       and c.bloque is false
  );
$$;

revoke all on function public.partenaire_actif() from public;
grant execute on function public.partenaire_actif() to authenticated;

-- ------------------------------------------------------------
-- 4. RATTACHEMENT DES COMPTES PARTENAIRES HISTORIQUES
-- ------------------------------------------------------------
-- POINT DE BLOCAGE IDENTIFIÉ ET MESURÉ. La connexion partenaire
-- cherche la fiche par `auth_user_id`, PUIS retombe sur un repli par
-- e-mail pour les comptes créés avant la liaison directe. Or la
-- politique de la phase de durcissement autorise le propriétaire sur
-- `auth_user_id = auth.uid()` : une fiche dont `auth_user_id` est NULL
-- devient invisible pour son propre titulaire, et le repli par e-mail
-- ne renvoie plus rien. Résultat : « Aucun dossier convoyeur trouvé »
-- et un partenaire légitime EXCLU de son espace.
--
-- On règle donc la donnée AVANT de durcir, et jamais par une politique
-- permissive sur l'e-mail.

-- Sauvegarde préalable : permet un retour arrière exact (cf. README).
create table if not exists public.convoyeurs_rattachement_sauvegarde (
  convoyeur_id     uuid primary key,
  auth_user_id_avant uuid,
  rattache_le      timestamptz not null default now()
);

-- Aucun privilège n'est accordé sur cette table : elle ne sert qu'aux
-- opérations d'administration effectuées depuis le SQL Editor.

-- Rattachement UNIQUEMENT des cas non ambigus : une seule fiche sans
-- liaison pour cet e-mail, et un seul compte d'authentification.
-- Les cas ambigus (doublons d'e-mail) sont volontairement laissés en
-- l'état : les traiter automatiquement risquerait de donner à quelqu'un
-- l'accès à la fiche d'un tiers.
with candidats as (
  select c.id as convoyeur_id, u.id as auth_user_id
    from public.convoyeurs c
    join auth.users u on lower(u.email) = lower(c.email)
   where c.auth_user_id is null
     and c.email is not null
   group by c.id, u.id
  having count(*) = 1
), sans_ambiguite as (
  select convoyeur_id, auth_user_id
    from candidats
   where auth_user_id in (
     select auth_user_id from candidats group by auth_user_id having count(*) = 1
   )
     and convoyeur_id in (
     select convoyeur_id from candidats group by convoyeur_id having count(*) = 1
   )
), trace as (
  insert into public.convoyeurs_rattachement_sauvegarde (convoyeur_id, auth_user_id_avant)
  select convoyeur_id, null from sans_ambiguite
  on conflict (convoyeur_id) do nothing
  returning convoyeur_id
)
update public.convoyeurs c
   set auth_user_id = s.auth_user_id
  from sans_ambiguite s
 where c.id = s.convoyeur_id;

-- ------------------------------------------------------------
-- 5. DIAGNOSTIC À LIRE AVANT DE PASSER À LA PHASE DE DURCISSEMENT
-- ------------------------------------------------------------
-- Doit renvoyer 0. Toute ligne restante est un partenaire qui SERA
-- exclu par le durcissement : le traiter à la main avant d'appliquer
-- 90_durcissement_rls_partenaires.sql.
--
--   select c.id, c.email, c.statut
--     from public.convoyeurs c
--    where c.auth_user_id is null
--      and c.statut = 'actif';
--
-- Doublons d'e-mail non rattachables automatiquement :
--
--   select lower(c.email) as email, count(*) as fiches
--     from public.convoyeurs c
--    where c.auth_user_id is null
--    group by 1 having count(*) > 1;
--
-- Administrateurs reconnus par est_admin() — doit renvoyer au moins 1,
-- sans quoi le durcissement fermerait le Dashboard à tout le monde :
--
--   select count(*) from public.admins where actif is true
--      and auth_user_id is not null;
