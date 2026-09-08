-- ============================================================
-- HelixCar — 00 : fonctions utilitaires partagées
-- ============================================================
-- À EXÉCUTER EN PREMIER. Aucune donnée n'est modifiée par ce fichier.
--
-- Ces migrations n'ont PAS été exécutées : elles sont fournies pour
-- application manuelle dans le SQL Editor Supabase, dans l'ordre des
-- préfixes numériques (00, 01, 02, ...).
--
-- Toutes les instructions sont idempotentes (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP POLICY IF EXISTS) : les rejouer ne casse
-- rien et ne duplique rien.

-- ------------------------------------------------------------
-- est_admin() — un administrateur actif est une ligne de
-- public.admins portant l'auth_user_id de la session en cours.
-- C'est EXACTEMENT le contrôle déjà effectué côté Dashboard
-- (finaliserSessionAdmin) : une seule définition de « qui est
-- administrateur », côté serveur cette fois.
--
-- SECURITY DEFINER est indispensable : la policy de lecture de
-- public.admins restreint déjà chaque ligne à son propre
-- auth.uid(), et une policy qui interrogerait admins depuis une
-- autre table provoquerait sinon une récursion.
-- search_path figé : protection contre le détournement de schéma.
-- ------------------------------------------------------------
create or replace function public.est_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.admins a
     where a.auth_user_id = auth.uid()
       and a.actif is true
  );
$$;

revoke all on function public.est_admin() from public;
grant execute on function public.est_admin() to authenticated;

comment on function public.est_admin() is
  'Vrai si la session en cours correspond à un administrateur actif de public.admins.';

-- ------------------------------------------------------------
-- est_proprietaire_convoyeur(uuid) — vrai si la session en cours
-- est le partenaire propriétaire de la candidature indiquée.
-- Sert aux politiques « un candidat ne gère que sa propre
-- candidature et sa propre vidéo ».
-- ------------------------------------------------------------
create or replace function public.est_proprietaire_convoyeur(p_convoyeur_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.convoyeurs c
     where c.id = p_convoyeur_id
       and c.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.est_proprietaire_convoyeur(uuid) from public;
grant execute on function public.est_proprietaire_convoyeur(uuid) to authenticated;
