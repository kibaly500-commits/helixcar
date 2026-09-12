# Migrations SQL HelixCar — lot « nouveaux services & partenaires »

> **Aucune de ces migrations n'a été exécutée.** Elles sont fournies pour
> application manuelle par HelixCar, dans le SQL Editor Supabase.
> Aucun secret ne figure dans ce dossier.

## ⚠️ Déploiement en TROIS phases — lire avant toute exécution

Le durcissement RLS **ne peut pas** être compatible avec la version du
Dashboard actuellement en ligne. Le déploiement est donc scindé, et
l'ordre ci-dessous est **impératif**.

| Phase | Action | Compatible ancien Dashboard |
|---|---|---|
| **A** | `00` → `06` (migrations préparatoires, toutes additives) | ✅ **oui** |
| **B** | Déploiement de la nouvelle `dashboard.html` | — |
| **C** | `90_durcissement_rls_partenaires.sql` puis `91_durcissement_rls_clients.sql` | ❌ **non** — exige la phase B |
| **D** | `92` → `99` (correctifs et compléments du second lot) | ❌ **non** — exigent la phase C |

### Pourquoi la phase C ne peut pas venir plus tôt

L'ancien Dashboard envoie la clé `anon` sur **tous** ses appels REST :
`auth.uid()` y vaut `null`, donc `est_admin()` est faux et aucune
politique ne peut être satisfaite. Mesuré sur un PostgreSQL 16 local en
appliquant réellement ces fichiers (`tests/t_rls.sh`) :

| Opération de l'ancien Dashboard | Résultat après un durcissement prématuré |
|---|---|
| Lecture des candidatures / missions | **0 ligne, en HTTP 200** — l'écran se vide **sans aucune erreur** |
| `PATCH` (valider une candidature) | **`UPDATE 0`** — accepté, **ne modifie rien**, succès mensonger |
| `DELETE` (supprimer une candidature) | 204 avec **0 ligne supprimée** |
| `POST` (créer une mission) | rejet `42501` — la seule erreur réellement visible |

La lecture vide et l'écriture silencieuse sont les deux dangers : elles
ne déclenchent aucune alerte.

La nouvelle `dashboard.html` corrige la cause — `sbFetch()` transmet le
JWT de la session ouverte — ce qui rend la phase C sans effet visible
pour les administrateurs.

### Ce que la phase A ne fait PAS

Le fichier `05` est volontairement **additif** : aucune activation de
RLS, aucune politique, et **pas** le garde-fou sur les colonnes
sensibles. Ce garde-fou lève une exception dès que `est_admin()` est
faux : installé en phase A, il ferait **échouer la validation et le
refus des candidatures** depuis l'ancien Dashboard. Il vit donc dans
`90`.

## Ordre d'application

Appliquer **dans l'ordre des préfixes**, un fichier à la fois, en
vérifiant qu'il se termine sans erreur avant de passer au suivant.

| Ordre | Phase | Fichier | Objet |
|---|---|---|---|
| 1 | A | `00_helpers.sql` | `est_admin()`, `est_proprietaire_convoyeur()` |
| 2 | A | `01_professionnel_details.sql` | `clients.professionnel_details` + index |
| 3 | A | `02_contact_sur_place.sql` | garde-fous + vue de lecture |
| 4 | A | `03_videos_candidature.sql` | métadonnées vidéo + bucket privé + policies Storage |
| 5 | A | `04_decisions_activites.sql` | décisions par activité + historique |
| 6 | A | `05_blocage_partenaire.sql` | colonnes de blocage, trace, `partenaire_actif()`, **rattachement des comptes historiques** |
| 7 | A | `06_informations_manquantes.sql` | `clients.auth_user_id`, informations à compléter, `informations_demande()`, `repondre_informations_demande()`, vue `v_mes_demandes` |
| — | **B** | **déploiement de `dashboard.html` ET de `index.html`** | `sbFetch()` transmet le JWT ; le formulaire public génère l'identifiant et n'attend plus de relecture |
| 8 | C | `90_durcissement_rls_partenaires.sql` | garde-fou + RLS `convoyeurs` et `missions` + politiques |
| 9 | C | `91_durcissement_rls_clients.sql` | RLS `clients` + accès client par la vue |
| 10 | **D** | `92_creation_demande_atomique.sql` | **correctif obligatoire** : `creer_demande_avec_vehicules()` — sans lui, plus aucune demande avec véhicules ne peut être déposée après la phase C |
| 11 | D | `93_bucket_video_300mo.sql` | limite du bucket vidéo portée à 300 Mo |
| 12 | D | `94_informations_selon_scenario.sql` | `informations_demande()` selon le scénario réel + `vehicules.livraison_apres_stockage` |
| 13 | D | `95_metiers_partenaires.sql` | `convoyeurs.metiers` + activité `technicien` acceptée |
| 14 | D | `96_missions_nettoyage.sql` | missions de nettoyage (`missions.type_mission` + colonnes d'intervention), photos avant/après, bucket privé `missions-photos` et ses politiques |
| 15 | **D** | `97_missions_verrou_serveur.sql` | **correctif de sécurité** : ce qu'un partenaire a le droit de changer sur une mission — colonnes, transitions de statut, attribution, photos exigées |
| 16 | **D** | `98_photos_justificatives_reelles.sql` | **correctif de sécurité** : une photo n'est acceptée que si son fichier existe réellement dans le bucket privé et appartient à la mission ; `ajoutee_par` imposé par le serveur |
| 17 | **D** | `99_reclamation_demande.sql` | **correctif fonctionnel** : rattacher sa demande après confirmation d'adresse — session, adresse confirmée et identique, identifiant exact, secret dont seule l'empreinte est stockée, expiration, consommation. Le secret de réclamation est **distinct** de celui de création (§ *Deux secrets*, ci-dessous) |
| 18 | **E** | `100_activites_partenaire.sql` → `104_identite_unique_roles_multiples.sql` | lots des Pull Requests nº 3 et nº 4 (déjà appliquées jusqu'à `102` ; `103` et `104` livrées par la PR nº 4) |
| 19 | **E** | `105_video_envoi_en_deux_phases.sql` | **correctif P0 (lot V01)** : l'envoi de la vidéo de candidature en deux phases — colonnes d'envoi en cours, finalisation atomique réservée à `service_role`, garde-fou de `90` aligné sur `97` et renforcé. Sans elle, la fonction `candidature-video` livrée ne peut pas confirmer une vidéo |
| 20 | **E** | `106_devis_versions_et_journal_envois.sql` | **correctif P0 (lot Q01)** : version de devis, états séparés (consulté, paiement en attente), journal `devis_envois` fermé par RLS. Sans elle, la fonction `devis-secure` livrée ne peut pas préparer ni envoyer |
| 21 | **E** | `107_reconciliation_partenaires_historiques.sql` | Rattache uniquement la fiche canonique portant l'historique lorsqu'une identité Auth correspond à plusieurs anciennes fiches ; aucune suppression ni fusion silencieuse. |
| 22 | **E** | `108_opportunites_missions.sql` | **lot O01** : opportunités privées, candidatures uniques, attribution atomique N sur N, clôture à N/N seulement (C03), journal d'intentions de notification (C11), vues partenaire / administrateur. Testée par `tests/rls/o01.sh` |
| 22 | **E** | `109_fidelite_points.sql` | **lot L01** (C10) : registre `fidelite_mouvements`, paliers 2 000 → 10 000 puis Box mystère tous les 2 000 points, vue `v_ma_fidelite`, garde-fou de l'état de paiement, contrepassations. Testée par `tests/rls/l01.sh` |
| 23 | **E** | `110_paiement_confirme_et_mission.sql` | **lot Q02** (C02) : journal `paiement_evenements`, `traiter_paiement_confirme` réservée à `service_role` (futur webhook), création de mission de nettoyage **seulement** si devis accepté ET payé ET informations complètes, déclencheur de complétion, `v_mes_devis`. Testée par `tests/rls/q02.sh` |
| 31 | **E** | `118_performance_rls_et_cles_etrangeres.sql` | index couvrants des clés étrangères signalées par l'analyseur Supabase et init-plan des politiques RLS ; permissions et résultats inchangés. Testée par `tests/rls/z_performance.sh` |
| 32 | **E** | `119_nettoyage_alertes_analyseur.sql` | retire l'appel RPC possible du garde vidéo, l'index `type_service` dupliqué et l'ancienne politique de dépôt strictement redondante. Testée par `tests/rls/z_performance.sh` |
| 33 | **E** | `120_rib_partenaire_prive.sql` | Demande le RIB seulement après validation, dans un bucket privé limité à 10 Mo ; lecture propriétaire/admin et rattachement contrôlés côté serveur. |
| 34 | **E** | `121_justificatif_immatriculation_partenaire.sql` | Ajoute le justificatif d'immatriculation (Kbis ou attestation RNE) aux candidatures partenaires ; la RC Pro devient conditionnelle au convoyage dans le formulaire. |
| 35 | **E** | `122_video_obligatoire_tous_partenaires.sql` | Rend la vidéo de présentation obligatoire pour tout métier : 60 s pour le convoyage seul, 120 s pour les autres métiers et les combinaisons. |
| 24 | **E** | `111_evaluations_et_missions_client.sql` | **lot D01** : `evaluations` (une par mission, écriture par `evaluer_mission` seulement), `v_mes_missions`. Testée par `tests/rls/d01.sh` |
| 25 | **E** | `112_plafonds_mission_et_nettoyage_reserve.sql` | **lot F01** : plafonds serveur Mission 166 / Type de mission 156, contrôle des changements de catégorie, Nettoyage réservé aux entreprises, conservation des anciens dossiers. Tests préparés dans `tests/rls/f01.sh`, **non exécutés pendant la reprise Codex** (PostgreSQL indisponible). Aucune application distante. |
| 26 | **E** | `113_devis_identite_et_archives.sql` | Identité des décisions, archives immuables du devis et opérations d'envoi privées. |
| 27 | **E** | `114_video_verification_serveur.sql` | Mesures vidéo serveur et objet final immuable ; à appliquer avec le worker et la fonction correspondante. |
| 28 | **E** | `115_durcissement_analyseur_supabase.sql` | Ferme les droits `SECURITY DEFINER` hérités, active RLS sur les tables historiques et définit les politiques des factures, états des lieux et documents. |
| 29 | **E** | `116_fermeture_vues_historiques.sql` | Retire les privilèges Data API implicites des anciennes vues administratives et limite `v_mes_demandes` à la lecture authentifiée. |
| 30 | **E** | `117_jeton_worker_video.sql` | Jeton serveur à usage unique pour donner au worker vidéo une URL de lecture courte sans lui fournir de clé privée Supabase. |

### Deux secrets, et pourquoi `92` retire une signature

La migration `92` publie désormais `creer_demande_avec_vehicules` avec
**quatre** arguments : `p_cle_reclamation` s'ajoute à `p_cle_creation`.

* le **secret de création** prouve un rejeu ; il ne quitte jamais la
  page et n'est écrit nulle part ;
* le **secret de réclamation** est le seul que le navigateur conserve,
  et il n'ouvre que `reclamer_demande()`.

Les deux empreintes sont préfixées par leur usage
(`public.empreinte_secret`) : la même chaîne ne produit pas la même
valeur selon le mécanisme auquel on la présente. Un secret de
réclamation ne peut donc **jamais** satisfaire la vérification de
création.

Ajouter un paramètre ne remplace pas une fonction PostgreSQL : cela en
crée une seconde. PostgREST se retrouverait devant deux candidates et
refuserait de choisir — **toutes** les créations de demande
échoueraient. La migration `92` retire donc explicitement la signature à
trois arguments avant de créer celle à quatre :

```sql
drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb, text);
```

Contrôle après application :

```sql
select count(*), min(pronargs) from pg_proc
 where proname = 'creer_demande_avec_vehicules';
-- attendu : 1 | 4
```

### Pourquoi `97` ne peut pas attendre

La policy de `90` autorise un partenaire actif à modifier une mission qui
lui est attribuée — **sans jamais regarder QUELLE colonne** il modifie :

```sql
with check (public.partenaire_actif())
```

Le Dashboard ne propose que deux boutons, mais un partenaire n'est pas
obligé de passer par le Dashboard. Une requête `PATCH` directe sur l'API
REST, avec son propre jeton de session, suffit à changer le prix d'une
mission, la rattacher à un autre client, la passer en « terminee » ou
cocher la validation de paiement. **Reproduit sur PostgreSQL 16**
(`tests/t_rls.sh`, section Z, contrôles Z1 et Z2).

`97` ferme cela par un trigger, qui s'applique à **tout** chemin
d'écriture — REST, RPC, SQL Editor — et pas seulement aux boutons.

### Pourquoi la phase D vient APRÈS la phase C

`92` corrige une panne que la phase C **provoque**. `public.vehicules`
porte une politique d'insertion qui vérifie l'existence du dossier
parent :

```sql
with check (exists (select 1 from public.clients c where c.id = vehicules.dossier_id))
```

Tant que `clients` n'avait aucune RLS, cette sous-requête voyait la
ligne. Après `91`, un visiteur anonyme ne voit plus la demande qu'il
vient pourtant de créer : la sous-requête ne renvoie rien, et
PostgreSQL rejette avec
`new row violates row-level security policy for table "vehicules"`.
Reproduit sur PostgreSQL 16 (`tests/t_rls.sh`, section V), y compris la
**création partielle** : la demande était écrite, ses véhicules non.

`92` est donc **obligatoire** et doit suivre `91` de très près — idéalement
dans la même fenêtre de maintenance. Les trois autres fichiers de la
phase D sont des compléments : ils n'ont aucun effet destructeur et
peuvent être appliqués juste après, dans l'ordre.

> **Ne pas appliquer la phase D avant que la Pull Request ne soit
> relue et prête à être fusionnée** : `94` et `95` accompagnent des
> évolutions de `index.html` et `dashboard.html` livrées dans la même
> Pull Request.

Toutes les instructions sont **idempotentes** : la chaîne complète a été
appliquée **deux fois de suite** sur PostgreSQL 16 sans erreur, sans
politique en double, sans trigger en double et sans ligne d'historique
inventée (`tests/t_rls.sh`, section F).

## Vérifications AVANT / APRÈS chaque phase

### Avant la phase A
```sql
-- Doit renvoyer au moins 1 : sans administrateur reconnaissable,
-- la phase C fermerait le Dashboard à tout le monde.
select count(*) from public.admins where actif is true and auth_user_id is not null;
```

### Après la phase A — bloquant pour la suite
```sql
-- 1. Doit renvoyer 0. Chaque ligne restante est un partenaire ACTIF qui
--    serait EXCLU de son espace par la phase C (voir ci-dessous).
select id, email, statut from public.convoyeurs
 where auth_user_id is null and statut = 'actif';

-- 2. Doublons d'e-mail non rattachables automatiquement : à traiter à la main.
select lower(email) as email, count(*) from public.convoyeurs
 where auth_user_id is null group by 1 having count(*) > 1;

-- 3. L'ancien Dashboard doit continuer de fonctionner normalement :
--    listes remplies, validation d'une candidature effective.
```

> **Pourquoi le point 1 est bloquant.** La connexion partenaire cherche
> la fiche par `auth_user_id`, puis retombe sur un **repli par e-mail**
> pour les comptes anciens. La politique de la phase C autorise le
> propriétaire sur `auth_user_id = auth.uid()` : une fiche dont
> `auth_user_id` est `NULL` devient invisible **pour son propre
> titulaire**, et le repli par e-mail ne renvoie plus rien — le
> partenaire lit « Aucun dossier convoyeur trouvé ». La phase A
> rattache automatiquement les cas **non ambigus** ; les autres doivent
> être traités à la main avant la phase C.

### Avant la phase C
1. La nouvelle `dashboard.html` est **effectivement servie** (vider le
   cache, recharger) et un administrateur s'y est connecté avec succès.
2. Le contrôle « après phase A » renvoie bien 0.
3. **La nouvelle `index.html` est effectivement servie.** Elle est
   indispensable à `91` : l'ancienne insérait la demande avec
   `Prefer: return=representation` et **relisait** la ligne pour obtenir
   son identifiant (nécessaire à l'enregistrement des véhicules). Sous
   RLS, un dépôt anonyme n'a aucun droit de lecture : cette relecture
   échoue avec `new row violates row-level security policy` et **la
   demande du client serait perdue**. Vérifié sur PostgreSQL 16. La
   nouvelle version génère l'identifiant côté navigateur et écrit en
   `return=minimal`.

### Après la phase C
Depuis la session d'un **client de test** :
```sql
select * from public.clients;         -- 0 ligne : voulu, le client passe par la vue
select * from public.v_mes_demandes;  -- uniquement SES demandes
update public.clients set statut = 'validee' where auth_user_id = auth.uid();
-- doit ne modifier AUCUNE ligne
```
Depuis la session d'un **autre client** : `v_mes_demandes` ne doit
contenir **aucune** demande du premier.

Depuis la session d'un **partenaire de test bloqué** :
```sql
-- 1 ligne : un partenaire bloqué garde SA fiche, et elle seule.
--    Choix assumé : la masquer ferait échouer la connexion sur
--    « aucun dossier trouvé », un message trompeur. C'est cette ligne
--    que le contrôle d'accès relit pour afficher la suspension.
select id, bloque from public.convoyeurs;

select * from public.convoyeur_decisions;   -- 0 ligne (réservé aux admins)
select * from public.missions;              -- 0 ligne : l'effet réel du blocage

-- Doit échouer ou ne modifier aucune ligne — jamais réussir.
update public.convoyeurs set bloque = false where auth_user_id = auth.uid();
```
Puis, depuis un compte **administrateur** : le partenaire bloqué reste
visible, son déblocage rétablit l'accès aux missions, et **aucune
décision par activité n'est modifiée** — une activité refusée ou en
attente le reste.

### Après la phase D
```sql
-- 92 : la fonction de création atomique existe et est exécutable
--      par un visiteur anonyme (c'est tout l'objet du correctif).
select has_function_privilege('anon',
  'public.creer_demande_avec_vehicules(jsonb, jsonb)', 'execute');   -- doit renvoyer true

-- 93 : la limite du bucket vidéo
select id, public, file_size_limit from storage.buckets
 where id = 'candidatures-videos';        -- public = false, limite = 314572800

-- 94 : la colonne de décision de sortie de stockage
select column_name from information_schema.columns
 where table_name = 'vehicules' and column_name = 'livraison_apres_stockage';

-- 95 : les métiers et l'activité technicien
select column_name from information_schema.columns
 where table_name = 'convoyeurs' and column_name = 'metiers';
select pg_get_constraintdef(oid) from pg_constraint
 where conname = 'convoyeur_decisions_activite_check';   -- doit inclure 'technicien'

-- 96 : les missions de nettoyage et leurs photos
select count(*) from public.missions where type_mission <> 'convoyage';  -- 0 juste après
select id, public from storage.buckets where id = 'missions-photos';     -- public = false
select policyname from pg_policies
 where tablename = 'mission_photos';                     -- 6 politiques attendues
```

Puis, depuis le site :
1. déposer une demande de convoyage **à deux véhicules** — elle doit
   aboutir, et les deux véhicules doivent apparaître dans le Dashboard ;
2. ouvrir la fiche d'une demande de nettoyage dont le contact sur place
   est renseigné — il ne doit **plus** figurer dans « Encore manquantes » ;
3. déposer une candidature **technicien** — l'activité doit être
   acceptée et apparaître avec ses spécialités dans le Dashboard ;
4. ouvrir une demande de **nettoyage** complète, établir son devis, puis
   cliquer sur « Créer la mission de nettoyage » — la mission doit
   apparaître dans l'onglet Missions avec le badge 🧼 Nettoyage, et
   n'être proposée qu'aux partenaires ayant déclaré ce métier.

## Retour arrière

### Revenir sur la phase C
```sql
alter table public.clients    disable row level security;
alter table public.missions   disable row level security;
alter table public.convoyeurs disable row level security;
drop trigger if exists trg_garde_colonnes_sensibles_convoyeur on public.convoyeurs;
```
> ⚠️ Cela **rouvre** les données partenaires à la clé `anon`, c'est-à-dire
> l'état antérieur à ce lot. À n'utiliser qu'en dépannage immédiat. La
> bonne réponse reste de vérifier que la nouvelle `dashboard.html` est
> bien celle qui est servie.

### Revenir sur la phase A
```sql
drop trigger  if exists trg_tracer_blocage_convoyeur on public.convoyeurs;
drop function if exists public.tracer_blocage_convoyeur();

-- Annuler le rattachement des comptes historiques (état exact restauré) :
update public.convoyeurs c
   set auth_user_id = s.auth_user_id_avant
  from public.convoyeurs_rattachement_sauvegarde s
 where c.id = s.convoyeur_id;
```
> Ne **pas** supprimer les colonnes `bloque*` : la connexion partenaire
> lit `bloque`. Les laisser en place est sans effet tant que la phase C
> n'est pas appliquée.

### Revenir sur la phase D

| Fichier | Retour arrière | Perte de données ? |
|---|---|---|
| `99` | `drop function if exists public.reclamer_demande(uuid, text);`, `drop function if exists public.armer_reclamation(uuid, text);`, `drop function if exists public.duree_reclamation();`. Laisser les deux colonnes `reclamation_*` en place. NE PAS retirer `public.empreinte_secret` : `92` s'en sert. | **Aucune** — mais la phrase « elle apparaîtra dans votre espace une fois votre adresse confirmée » redevient FAUSSE. La retirer alors d'`index.html`. Les demandes déjà rattachées le restent. |
| `98` | `drop trigger if exists trg_verrou_photo_mission on public.mission_photos;` puis `drop function if exists public.verrou_photo_mission();`, et réappliquer `97` pour retrouver l'ancienne `mission_photos_completes()`. | **Aucune** — mais revenir dessus permet de nouveau de justifier une prestation avec des photos qui n'existent pas. |
| `97` | `drop trigger if exists trg_verrou_maj_mission on public.missions;` puis `drop trigger if exists trg_verrou_creation_mission on public.missions;` et les cinq fonctions listées en fin de fichier. | **Aucune** : ces objets ne font que contrôler. Mais les revenir rouvre le défaut de sécurité qu'ils ferment. |
| `96` | Laisser les colonnes de `public.missions` et la table `mission_photos` EN PLACE : ce sont des missions et des pièces justificatives réellement créées. Seules les politiques Storage peuvent être retirées (voir la fin du fichier). | Retirer la table supprimerait les photos d'état des véhicules. |
| `95` | Laisser `convoyeurs.metiers` en place (nullable, ignorée par l'ancienne version). Ne revenir sur la contrainte que si `select count(*) from public.convoyeur_decisions where activite = 'technicien'` renvoie 0. | Retirer la colonne supprimerait des métiers réellement déclarés. |
| `94` | Réappliquer `06_informations_manquantes.sql` : il contient la version précédente de `informations_demande(uuid)`, même signature. Laisser `vehicules.livraison_apres_stockage` en place. | Aucune : `94` ne touche qu'une fonction de lecture et ajoute une colonne vide. |
| `93` | `update storage.buckets set file_size_limit = 52428800 where id = 'candidatures-videos';` | Les vidéos déjà déposées au-delà de la limite restent lisibles. |
| `92` | `drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb);` — **uniquement** si l'ancienne `index.html` est remise en ligne en même temps, sans quoi plus aucune demande ne peut être déposée. | Aucune. |

### Fenêtre d'exposition à connaître
Entre les phases A et C, `convoyeurs` reste **sans RLS**, exactement
comme aujourd'hui : la phase A n'ouvre rien de plus, mais ne referme
rien non plus. La colonne `bloque_motif` créée en phase A serait donc
lisible avec la clé `anon` tant que la phase C n'est pas passée. En
conséquence : **enchaîner B et C dans la même fenêtre de maintenance**,
et **ne bloquer aucun partenaire avant la phase C**.

### Phase E — lots P0 de la révision experte (105 et 106)

`105` et `106` sont additives et idempotentes. Elles accompagnent le
redéploiement de **deux** Edge Functions, qu'une fusion ne redéploie pas :

```bash
# depuis la racine du dépôt (supabase/config.toml y est lu)
supabase functions deploy candidature-video
supabase functions deploy devis-secure
```

`devis-secure` vivait à la racine du dépôt (`index.ts`), hors de
l'arborescence que la CLI sait déployer ; elle est désormais dans
`supabase/functions/devis-secure/index.ts`, avec son réglage
`verify_jwt = false` versionné (la page publique `devis.html` l'appelle
sans session ; les actions administrateur vérifient elles-mêmes le JWT
et l'appartenance à `public.admins`).

Variables d'environnement des Edge Functions (Supabase → Edge Functions
→ Secrets) — **aucune n'est lue ni écrite par ce dépôt** :

| Variable | Fonction | Rôle |
|---|---|---|
| `RESEND_API_KEY` | `devis-secure` | déjà requise : envoi réel du devis |
| `RESEND_FROM` | `devis-secure` | facultative : expéditeur une fois le domaine vérifié chez Resend (défaut : `HelixCar <onboarding@resend.dev>`) |
| `HELIXCAR_URL_PUBLIQUE` | `devis-secure` | facultative : URL publique canonique des liens envoyés aux clients (défaut : l'origine autorisée qui appelle, puis `https://helixcar.vercel.app`). À renseigner **seulement** lors du branchement du domaine officiel |
| `HELIXCAR_ORIGINES_SUPPLEMENTAIRES` | les deux | facultative : origines CORS à ajouter (ex. `https://helixcar.fr,https://www.helixcar.fr`), **sans** retirer les origines Vercel pendant la transition |

Contrôles après application :

```sql
-- 105
select count(*) from information_schema.columns
 where table_name = 'convoyeurs'
   and column_name in ('video_envoi_chemin','video_envoi_mime','video_envoi_taille_octets',
                       'video_envoi_duree_secondes','video_envoi_commence_le','video_upload_jeton_consomme_le');
-- attendu : 6
select conname from pg_constraint
 where conrelid = 'public.convoyeurs'::regclass
   and conname in ('convoyeurs_video_coherente','convoyeurs_video_envoi_coherent');
-- attendu : les DEUX
select count(*) from information_schema.role_routine_grants
 where routine_name = 'finaliser_video_candidature' and grantee in ('anon','authenticated');
-- attendu : 0

-- 106
select count(*) from information_schema.columns
 where table_name = 'devis'
   and column_name in ('version','version_preparee','version_envoyee','version_acceptee','consulte_le',
                       'envoi_en_cours_depuis','paiement_statut','paiement_confirme_le','annule_le','expire_le');
-- attendu : 10
select policyname from pg_policies where tablename = 'devis_envois';
-- attendu : « devis_envois : lecture admin » uniquement
```

## Réglages manuels Supabase (hors SQL)

0. **Déployer la fonction `candidature-video`** — *indispensable au
   dépôt des vidéos.* Le navigateur n'a **aucun droit d'écriture** sur le
   bucket : sans cette fonction, une candidature Convoyage ou Renfort ne
   peut pas envoyer sa vidéo.

   ```bash
   # Depuis la racine du dépôt : supabase/config.toml y est lu.
   supabase functions deploy candidature-video
   ```

   **Lancer la commande depuis la racine du dépôt**, et non depuis un
   autre dossier : c'est là que se trouve `supabase/config.toml`, qui
   porte le réglage sans lequel la fonction répondrait `401` à toute
   candidature —

   ```toml
   [functions.candidature-video]
   verify_jwt = false
   ```

   *Pourquoi ce réglage.* Une candidature est déposée **avant** toute
   authentification : le candidat n'a pas encore de compte. Le navigateur
   envoie donc `apikey`, mais **aucun JWT utilisateur**. Avec la
   vérification JWT du gateway active — le défaut de Supabase — la
   requête est refusée avant d'atteindre la moindre ligne de code.

   Cela n'ouvre rien : l'autorisation réelle est assurée par la fonction
   elle-même, et elle est plus stricte que ce que le gateway saurait
   faire — jeton applicatif à usage unique haché en base, chemin de
   destination généré par le serveur, URL d'envoi signée et temporaire
   sur un bucket privé, origine HTTP contrôlée.

   Le réglage est **versionné dans le dépôt**, pas coché à la main dans
   une interface : il se relit, se relie à une revue de code, et survit
   à une recréation du projet.

   Elle utilise `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, déjà
   présentes dans l'environnement des Edge Functions. **Cette clé ne doit
   jamais être placée ailleurs que là.**

0 bis. **Vérifier le réglage après déploiement.** Supabase → Edge
   Functions → `candidature-video` : la vérification JWT doit apparaître
   comme **désactivée**. Si l'interface affiche l'inverse, le déploiement
   n'a pas lu `config.toml` — recommencer depuis la racine du dépôt.

1. **Storage → `candidatures-videos`** : vérifier que le bucket apparaît
   bien comme **Private**. C'est le point de sécurité central des vidéos.
1 bis. **Storage → `missions-photos`** : créé par la migration `96`.
   Vérifier lui aussi qu'il apparaît comme **Private** — les photos
   d'état des véhicules sont des pièces, jamais des illustrations
   publiques.
2. **Aucune clé `service_role` côté navigateur.** La lecture d'une vidéo
   passe par une **URL signée temporaire** (`createSignedUrl`, 60–300 s),
   générée depuis une session authentifiée, après le contrôle
   d'autorisation assuré par les policies.
3. **Storage → Settings → limite globale de taille de fichier.** La
   migration `93` porte la limite du bucket à **300 Mo**, mais Supabase
   applique **aussi** une limite globale au projet. Tant que celle-ci
   reste inférieure, c'est elle qui s'applique : une vidéo de 200 Mo
   serait refusée malgré le réglage du bucket. À porter à **300 Mo au
   minimum**, dans l'interface — ce réglage n'est pas accessible en SQL.
4. **Conservation des vidéos** : définir une durée (par exemple 12 mois
   après refus ou inactivité) et la mentionner dans la politique de
   confidentialité **avant** toute mise en service.
5. **Rattachement de l'historique client** : le rapprochement des
   demandes existantes à un compte est laissé volontairement non exécuté
   (requête fournie en commentaire dans `06`) — un rapprochement par
   e-mail peut exposer la demande d'un tiers en cas d'adresse réutilisée.
6. **URL de redirection à autoriser (Supabase → Authentication → URL Configuration).**
   Le lien de réinitialisation du mot de passe renvoie vers
   `<origine du site>/dashboard.html`. Supabase **refuse** toute
   redirection non autorisée : le lien retomberait alors sur la page
   d'accueil sans ouvrir le formulaire. À déclarer :

   | Champ | Valeur |
   |---|---|
   | Site URL | `https://helixcar-i89b.vercel.app` |
   | Redirect URLs | `https://helixcar-i89b.vercel.app/dashboard.html` |
   | Redirect URLs (préversions Vercel, si utilisées pour la recette) | `https://helixcar-i89b-*.vercel.app/dashboard.html` |
   | Redirect URLs (développement local, si utilisé) | `http://localhost:3000/dashboard.html` |

   N'ajoutez que les origines réellement servies : chaque entrée est une
   destination de redirection acceptée après authentification.

6. **Longueur minimale du mot de passe côté Auth (Supabase → Authentication
   → Providers → Email → *Minimum password length*).** Régler sur **8**.

   Les trois parcours de création ou de modification appliquent déjà 8
   caractères dans le navigateur (inscription client, inscription
   partenaire, nouveau mot de passe). Ce réglage ferme la porte côté
   serveur : sans lui, un appel direct à l'API Supabase pourrait encore
   créer un mot de passe plus court.

   > La règle porte sur la **création et la modification**. Elle
   > n'empêche pas un compte plus ancien de se connecter avec un mot de
   > passe historique plus court — c'est voulu.

7. **Authentification des clients (Supabase → Authentication).** Les
   comptes clients sont désormais créés par le formulaire public
   (`auth.signUp`). Décider explicitement si la **confirmation d'adresse
   e-mail** est exigée : si elle l'est, le client ne peut pas se
   connecter avant d'avoir cliqué le lien reçu, et son espace reste
   inaccessible entre-temps. Adapter le modèle d'e-mail de confirmation
   dans Supabase — c'est un e-mail **du service d'authentification**, pas
   un e-mail EmailJS ; aucun modèle EmailJS n'a été touché.
8. **Demandes déposées sans compte** : `clients.auth_user_id` reste NULL.
   Elles n'apparaissent dans aucun espace client — comportement voulu,
   aucun rattachement automatique par e-mail n'est effectué.

## Paiement de recette et futur Stripe

Aucun objet Stripe n'existe dans le dépôt. Depuis la migration `110`, le
serveur sait **recevoir** une confirmation de paiement :
`traiter_paiement_confirme(devis_id, fournisseur, evenement_id, montant,
devise, detail)` — exécutable uniquement avec la clé `service_role`
(jamais depuis une session), idempotente par événement, et elle crée la
mission de nettoyage si le dossier est complet (sinon la dernière
information transmise la crée). Le futur webhook Stripe devra vérifier la
signature de l'événement puis appeler cette fonction.

La fonction `paiement-recette` fournit entre-temps une simulation sans
prestataire et sans débit, limitée aux Previews exactes et aux dossiers
`TEST-QA-CLAUDE-HELIXCAR`. Elle réutilise la même RPC serveur pour le cas
réussi ; elle ne remplace ni Checkout, ni la signature d'un webhook, ni une
preuve de paiement réel. Voir `tests/RECETTE-PAIEMENT.md`.
