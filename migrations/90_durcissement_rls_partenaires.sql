-- ============================================================
-- HelixCar — 90 : DURCISSEMENT RLS DES DONNÉES PARTENAIRES
-- ============================================================
-- Dépend de : 00_helpers.sql, 04_decisions_activites.sql,
--             05_blocage_partenaire.sql
--
-- ⚠️⚠️ DERNIÈRE PHASE. À N'APPLIQUER QU'APRÈS LE DÉPLOIEMENT DE LA
-- NOUVELLE VERSION DE dashboard.html.
--
-- Numéroté 90 et non 06 pour rendre l'ordre évident : ce fichier
-- s'applique APRÈS TOUS LES AUTRES, et après une mise en ligne.
--
-- POURQUOI. L'ancien Dashboard envoie la clé `anon` sur tous ses appels
-- REST : `auth.uid()` y vaut null, donc `est_admin()` est faux et
-- AUCUNE politique ci-dessous ne peut être satisfaite. Appliqué trop
-- tôt, ce fichier :
--   * vide toutes les listes en HTTP 200, sans message d'erreur ;
--   * transforme les mises à jour en « UPDATE 0 » silencieux, la seule
--     erreur visible étant l'insertion d'une mission.
-- La nouvelle version de dashboard.html corrige la cause : sbFetch()
-- transmet le JWT de la session ouverte.
--
-- VÉRIFICATION OBLIGATOIRE AVANT D'EXÉCUTER CE FICHIER
--   1. La nouvelle interface est en ligne et un administrateur s'y est
--      connecté avec succès.
--   2. Le diagnostic de 05 renvoie 0 partenaire actif sans auth_user_id.
--   3. Il existe au moins un administrateur actif avec un auth_user_id.

-- ------------------------------------------------------------
-- 1. GARDE-FOU : les colonnes sensibles sont réservées à l'admin
-- ------------------------------------------------------------
-- Volontairement placé ICI et non en phase préparatoire : ce trigger
-- lève une exception quand `est_admin()` est faux, ce qui est le cas de
-- TOUS les appels de l'ancien Dashboard (clé anon). Installé trop tôt,
-- il ferait échouer la validation et le refus des candidatures.
create or replace function public.garde_colonnes_sensibles_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.est_admin() then
    return new;
  end if;
  if new.bloque       is distinct from old.bloque
     or new.bloque_le    is distinct from old.bloque_le
     or new.bloque_par   is distinct from old.bloque_par
     or new.bloque_motif is distinct from old.bloque_motif
     or new.statut       is distinct from old.statut then
    raise exception 'Modification réservée à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_garde_colonnes_sensibles_convoyeur on public.convoyeurs;
create trigger trg_garde_colonnes_sensibles_convoyeur
  before update on public.convoyeurs
  for each row execute function public.garde_colonnes_sensibles_convoyeur();

-- ------------------------------------------------------------
-- 2. RLS sur la table des candidatures
-- ------------------------------------------------------------
alter table public.convoyeurs enable row level security;

-- Un partenaire lit SA PROPRE fiche, bloqué ou non.
-- CHOIX ASSUMÉ : masquer aussi sa fiche ferait échouer la connexion sur
-- « aucun dossier trouvé » — un message trompeur. Le contrôle d'accès
-- existant (finaliserSessionConvoyeur) lit précisément `bloque` sur
-- cette ligne pour afficher un message neutre de suspension puis fermer
-- la session. Ce sont les DONNÉES PROTÉGÉES (missions) qui deviennent
-- inaccessibles, pas l'information « mon compte est suspendu ».
drop policy if exists "convoyeurs : lecture par le proprietaire non bloque" on public.convoyeurs;
drop policy if exists "convoyeurs : lecture par le proprietaire" on public.convoyeurs;
create policy "convoyeurs : lecture par le proprietaire"
  on public.convoyeurs for select to authenticated
  using (auth_user_id = auth.uid());

-- Un administrateur actif voit tout, y compris les partenaires bloqués
-- (sans quoi il ne pourrait plus jamais les débloquer).
drop policy if exists "convoyeurs : lecture admin" on public.convoyeurs;
create policy "convoyeurs : lecture admin"
  on public.convoyeurs for select to authenticated
  using (public.est_admin());

-- Un partenaire met à jour SA candidature tant qu'il n'est pas bloqué.
-- Les colonnes de décision, de statut et de blocage restent hors de sa
-- portée : voir le garde-fou ci-dessus.
drop policy if exists "convoyeurs : mise a jour par le proprietaire non bloque" on public.convoyeurs;
create policy "convoyeurs : mise a jour par le proprietaire non bloque"
  on public.convoyeurs for update to authenticated
  using (auth_user_id = auth.uid() and bloque is false)
  with check (auth_user_id = auth.uid() and bloque is false);

drop policy if exists "convoyeurs : mise a jour admin" on public.convoyeurs;
create policy "convoyeurs : mise a jour admin"
  on public.convoyeurs for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- SUPPRESSION D'UNE CANDIDATURE — indispensable : le Dashboard propose
-- « Supprimer » (DELETE sur convoyeurs). Sans cette politique, la RLS
-- rend la ligne invisible et PostgREST répond 204 avec zéro ligne
-- supprimée : l'interface annoncerait une suppression qui n'a pas eu
-- lieu. Réservé à l'administrateur.
drop policy if exists "convoyeurs : suppression admin" on public.convoyeurs;
create policy "convoyeurs : suppression admin"
  on public.convoyeurs for delete to authenticated
  using (public.est_admin());

-- Le dépôt d'une candidature reste ouvert (formulaire public, clé anon),
-- comportement actuel inchangé. Le formulaire écrit avec
-- `Prefer: return=minimal` et ne relit jamais la ligne insérée : aucune
-- politique de lecture anonyme n'est donc nécessaire.
drop policy if exists "convoyeurs : depot de candidature" on public.convoyeurs;
create policy "convoyeurs : depot de candidature"
  on public.convoyeurs for insert to anon, authenticated
  with check (true);

-- ------------------------------------------------------------
-- 3. DONNÉES PROTÉGÉES : LES MISSIONS
-- ------------------------------------------------------------
-- C'est ICI que le blocage produit son effet réel. Un partenaire bloqué
-- garde sa fiche (pour voir qu'il est suspendu) mais ne lit ni ne
-- modifie plus aucune mission — quel que soit le JavaScript exécuté
-- dans son navigateur, en tapant l'URL de son espace, ou en appelant
-- directement l'API Supabase.
alter table public.missions enable row level security;

drop policy if exists "missions : lecture admin" on public.missions;
create policy "missions : lecture admin"
  on public.missions for select to authenticated
  using (public.est_admin());

drop policy if exists "missions : lecture partenaire actif" on public.missions;
create policy "missions : lecture partenaire actif"
  on public.missions for select to authenticated
  using (
    public.partenaire_actif()
    and (
      convoyeur_id is null
      or exists (
        select 1 from public.convoyeurs c
         where c.id = missions.convoyeur_id
           and c.auth_user_id = auth.uid()
      )
    )
  );

-- Écriture : un partenaire actif n'agit que sur SES missions (accepter,
-- avancer). Toute autre écriture reste réservée à l'administrateur.
drop policy if exists "missions : mise a jour partenaire actif" on public.missions;
create policy "missions : mise a jour partenaire actif"
  on public.missions for update to authenticated
  using (
    public.partenaire_actif()
    and (
      convoyeur_id is null
      or exists (
        select 1 from public.convoyeurs c
         where c.id = missions.convoyeur_id
           and c.auth_user_id = auth.uid()
      )
    )
  )
  with check (public.partenaire_actif());

drop policy if exists "missions : ecriture admin" on public.missions;
create policy "missions : ecriture admin"
  on public.missions for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- ------------------------------------------------------------
-- 4. RETOUR ARRIÈRE D'URGENCE
-- ------------------------------------------------------------
-- Si le Dashboard se vidait malgré tout, la remise en service immédiate
-- est :
--
--   alter table public.missions   disable row level security;
--   alter table public.convoyeurs disable row level security;
--
-- ⚠️ Cela ROUVRE les données partenaires à la clé anon, c'est-à-dire
-- l'état d'avant ce lot. À n'utiliser qu'en dépannage, et à refermer
-- dès que la cause est corrigée. La bonne réponse reste de vérifier que
-- la nouvelle version de dashboard.html est bien celle qui est servie.
--
-- Les politiques et le garde-fou peuvent être retirés séparément :
--   drop trigger if exists trg_garde_colonnes_sensibles_convoyeur on public.convoyeurs;
--
-- Les colonnes de blocage, elles, ne doivent PAS être supprimées : la
-- connexion partenaire lit `bloque`.
