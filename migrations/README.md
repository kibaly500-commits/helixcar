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

### Fenêtre d'exposition à connaître
Entre les phases A et C, `convoyeurs` reste **sans RLS**, exactement
comme aujourd'hui : la phase A n'ouvre rien de plus, mais ne referme
rien non plus. La colonne `bloque_motif` créée en phase A serait donc
lisible avec la clé `anon` tant que la phase C n'est pas passée. En
conséquence : **enchaîner B et C dans la même fenêtre de maintenance**,
et **ne bloquer aucun partenaire avant la phase C**.

## Réglages manuels Supabase (hors SQL)

0. **Déployer la fonction `candidature-video`** — *indispensable au
   dépôt des vidéos.* Le navigateur n'a **aucun droit d'écriture** sur le
   bucket : sans cette fonction, une candidature Convoyage ou Renfort ne
   peut pas envoyer sa vidéo.

   ```bash
   supabase functions deploy candidature-video
   ```

   Elle utilise `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, déjà
   présentes dans l'environnement des Edge Functions. **Cette clé ne doit
   jamais être placée ailleurs que là.**

1. **Storage → `candidatures-videos`** : vérifier que le bucket apparaît
   bien comme **Private**. C'est le point de sécurité central des vidéos.
2. **Aucune clé `service_role` côté navigateur.** La lecture d'une vidéo
   passe par une **URL signée temporaire** (`createSignedUrl`, 60–300 s),
   générée depuis une session authentifiée, après le contrôle
   d'autorisation assuré par les policies.
3. **Conservation des vidéos** : définir une durée (par exemple 12 mois
   après refus ou inactivité) et la mentionner dans la politique de
   confidentialité **avant** toute mise en service.
4. **Rattachement de l'historique client** : le rapprochement des
   demandes existantes à un compte est laissé volontairement non exécuté
   (requête fournie en commentaire dans `06`) — un rapprochement par
   e-mail peut exposer la demande d'un tiers en cas d'adresse réutilisée.
5. **URL de redirection à autoriser (Supabase → Authentication → URL Configuration).**
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

## Stripe

Aucun objet lié au paiement n'est créé : pas de colonne « payé », pas de
webhook, pas de création automatique de mission. L'enchaînement
paiement → complément → mission reste **dormant** et devra être activé
dans un lot ultérieur, uniquement sur confirmation serveur fiable.
