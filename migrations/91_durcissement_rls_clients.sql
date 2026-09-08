-- ============================================================
-- HelixCar — 91 : DURCISSEMENT RLS DES DEMANDES CLIENT
-- ============================================================
-- Dépend de : 00_helpers.sql, 06_informations_manquantes.sql
--
-- ⚠️⚠️ PHASE C. À N'APPLIQUER QU'APRÈS LE DÉPLOIEMENT DE LA NOUVELLE
-- VERSION DE dashboard.html ET DE index.html.
--
-- Même raison que 90 : l'ancien Dashboard lit `clients` avec la clé
-- `anon`. Activer la RLS pendant qu'il est en ligne viderait la liste
-- des clients et la liste des demandes de devis, en HTTP 200 et sans
-- la moindre erreur.
--
-- PRÉREQUIS SUPPLÉMENTAIRE PROPRE À CE FICHIER : le formulaire public
-- doit être celui de cette Pull Request. L'ancien envoyait
-- `Prefer: return=representation` et RELISAIT la ligne insérée pour
-- récupérer son identifiant (nécessaire à l'enregistrement des
-- véhicules). Sous RLS, un dépôt anonyme n'a aucun droit de lecture :
-- cette relecture échoue et LA CANDIDATURE DU CLIENT SERAIT PERDUE.
-- La nouvelle version génère l'identifiant côté navigateur et écrit en
-- `return=minimal` : plus aucune relecture n'est nécessaire.

alter table public.clients enable row level security;

-- ------------------------------------------------------------
-- Dépôt public : inchangé
-- ------------------------------------------------------------
-- Le formulaire public reste ouvert, exactement comme aujourd'hui.
-- Aucune politique de LECTURE n'est accordée à `anon` : déposer une
-- demande ne permet jamais d'en lire une.
drop policy if exists "clients : depot public" on public.clients;
create policy "clients : depot public"
  on public.clients for insert to anon, authenticated
  with check (true);

-- ------------------------------------------------------------
-- Administrateur : accès complet
-- ------------------------------------------------------------
drop policy if exists "clients : lecture admin" on public.clients;
create policy "clients : lecture admin"
  on public.clients for select to authenticated
  using (public.est_admin());

drop policy if exists "clients : ecriture admin" on public.clients;
create policy "clients : ecriture admin"
  on public.clients for all to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- ------------------------------------------------------------
-- CLIENT : AUCUNE politique de lecture sur la table
-- ------------------------------------------------------------
-- CHOIX ASSUMÉ ET IMPORTANT. Une politique « le client lit ses propres
-- lignes » filtrerait les LIGNES mais pas les COLONNES : le client
-- recevrait alors l'intégralité de la demande, y compris ses champs
-- administratifs. Le client lit donc UNIQUEMENT la vue
-- public.v_mes_demandes (créée en 06), qui filtre elle-même sur
-- auth.uid() et ne projette que les colonnes qui le concernent.
--
-- Conséquence vérifiable : un appel direct à /rest/v1/clients par un
-- client authentifié renvoie ZÉRO ligne — y compris pour ses propres
-- demandes.
--
-- Le client n'a par ailleurs AUCUNE politique d'écriture sur clients :
-- il ne peut donc modifier ni statut, ni prix, ni devis, ni paiement,
-- ni aucune autre donnée de sa demande. Sa seule écriture possible est
-- public.repondre_informations_demande(), qui vérifie elle-même qu'il
-- est propriétaire de la demande.

-- ------------------------------------------------------------
-- La vue doit contourner la RLS pour rester lisible par le client
-- ------------------------------------------------------------
-- security_invoker = off : la vue s'exécute avec les droits de son
-- propriétaire. C'est indispensable, puisque le client n'a aucune
-- politique de lecture sur la table sous-jacente. Le cloisonnement est
-- assuré par le `where c.auth_user_id = auth.uid()` de la vue
-- elle-même, qui ne peut pas être contourné par l'appelant.
alter view public.v_mes_demandes set (security_invoker = off);

-- ------------------------------------------------------------
-- RETOUR ARRIÈRE D'URGENCE
-- ------------------------------------------------------------
--   alter table public.clients disable row level security;
--
-- ⚠️ Rouvre les demandes à la clé anon, c'est-à-dire l'état d'avant ce
-- lot. Dépannage uniquement.

-- ------------------------------------------------------------
-- VÉRIFICATIONS APRÈS APPLICATION
-- ------------------------------------------------------------
-- Depuis la session d'un client de test :
--   select * from public.clients;          -> 0 ligne (voulu)
--   select * from public.v_mes_demandes;   -> uniquement SES demandes
-- Depuis la session d'un AUTRE client :
--   select * from public.v_mes_demandes;   -> aucune demande du premier
-- Depuis un dépôt anonyme (formulaire public) :
--   insert into public.clients (...) -> doit réussir
--   select from public.clients       -> 0 ligne
