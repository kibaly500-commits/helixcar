# HelixCar — Dossier de recette du lot « RLS véhicules et améliorations »

> **Branche** : `claude/helixcar-lot-rls-vehicules-et-ameliorations`
> **Pull Request** : nº 2 — **ouverte, non fusionnée**.
> **Aucune migration n'a été exécutée sur la base de production.**
> **Aucun e-mail réel n'a été envoyé. Aucune donnée réelle n'a été modifiée.**
> **Aucun déploiement Vercel ou Supabase n'a été déclenché.**

Ce document est écrit pour être lu **sans être développeur**. Il se lit dans
l'ordre : ce qui a été fait, ce qui a été prouvé, puis ce que vous avez à faire
vous-même, étape par étape.

---

## 1. Nombre exact de chantiers terminés

**15 chantiers sur 15 sont traités.**

La demande initiale comportait 15 points numérotés. Deux d'entre eux — le nº 1
(*état actuel à respecter*) et le nº 2 (*règles de sécurité et de livraison*) —
ne sont pas des développements mais des contraintes : ils sont **respectés de
bout en bout**, et la preuve de ce respect est donnée au § 2.1. Les **13 autres
points sont des chantiers de développement, et les 13 sont livrés**.

Aucun chantier n'est laissé en suspens, partiel ou reporté.

---

## 2. Liste détaillée : terminés / non terminés

| Nº | Chantier | État | Preuve |
|---|---|---|---|
| 1 | État actuel à respecter (contexte) | ✅ respecté | migrations 00→06, 90, 91 jamais modifiées ni rejouées ; fonction `candidature-video` réutilisée, non redéployée ; bucket resté privé |
| 2 | Règles de sécurité et de livraison | ✅ respecté | § 2.1 de ce document, point par point |
| 3 | **PRIORITÉ CRITIQUE — erreur RLS sur `vehicules`** | ✅ terminé | `migrations/92` + `t_rls.sh` section V (cause reproduite puis corrigée sur PostgreSQL 16) |
| 4 | **Candidature vidéo** (300 Mo, deux boutons, vrai enregistreur, envoi reprenable) | ✅ terminé | `migrations/93`, `t_video.js`, `t_enregistreur.js`, `t_tus.js`, `t_video_securite.mjs`, `tests/RECETTE-ENVOI-REPRENABLE.md` |
| 5 | **Formulaire « Trouver un professionnel automobile »** | ✅ terminé | `t_pro.js`, `t_pro_ui.js` |
| 6 | **Boutons Continuer et validations indépendantes** | ✅ terminé | `t_etapes.js` |
| 7 | **Calendrier, période et horaires** | ✅ terminé | `t_periode.js`, `t_dates.js` |
| 8 | **Délai annoncé « sous 1 heure »** | ✅ terminé | `t_pro.js` (contrôle textuel), `t_nonreg.js` |
| 9 | **Système de devis commun à toutes les demandes** | ✅ terminé | `t_devis_commun.js`, `t_devis.js` |
| 10 | **Informations nécessaires à la mission** | ✅ terminé | `migrations/94`, `t_infos.js`, `t_rls.sh` section W |
| 11 | **Dashboard aux couleurs HelixCar (fond blanc)** | ✅ terminé | `t_charte.js` (couleurs réellement calculées par le navigateur) |
| 12 | **Blocage et déblocage des partenaires** | ✅ terminé | `t_blocage.js`, `t_decisions.js`, `t_rls.sh` sections D et E |
| 13 | **Candidats qui recherchent un poste** (métiers, bouton +, badges retirables, profil, Dashboard) | ✅ terminé | `migrations/95`, `t_metiers.js`, `t_rls.sh` section X |
| 14 | **Nettoyage dans le Dashboard et missions** (mission attribuable, photos avant/après déposées **et relisibles**) | ✅ terminé | `migrations/96`, `t_mission_nettoyage.js`, `t_nettoyage_dashboard.js`, `t_rls.sh` section Y |
| 15 | **Cohérence complète des données mono / multi-véhicules** | ✅ terminé | `t_multivehicules.js` (48 contrôles de la saisie au PDF et à la fiche admin) |

**Non terminés : aucun.**

### 2.1 Les 17 règles de sécurité et de livraison, point par point

| Règle | Respectée | Comment le vérifier vous-même |
|---|---|---|
| 1. Partir du dernier `main` propre, sur une nouvelle branche | ✅ | `git log --oneline origin/main..HEAD` — 17 commits, aucun commit de `main` réécrit |
| 2. Ne rien supprimer ni écraser qui ne m'appartienne pas | ✅ | `git diff --name-only origin/main..HEAD -- migrations/` — aucune migration existante touchée |
| 3. Ne pas fusionner dans `main` | ✅ | la Pull Request nº 2 est **ouverte** |
| 4. Ne rien déployer sur Vercel ni Supabase | ✅ | aucun `supabase functions deploy`, aucun `vercel` n'a été lancé |
| 5. N'exécuter aucune migration sur la production | ✅ | l'environnement de travail **ne peut pas joindre `supabase.com`** (§ 5.1) ; les migrations n'ont tourné que sur un PostgreSQL 16 local jetable |
| 6. N'envoyer aucun e-mail réel | ✅ | **douze suites** surveillent les appels EmailJS et échouent si un seul part (§ 5.8) |
| 7. Ne contacter aucun client, n'effectuer aucun paiement | ✅ | aucun appel sortant vers un client ou un prestataire de paiement dans le diff |
| 8. Ne modifier ni supprimer aucune donnée réelle | ✅ | conséquence directe de la règle 5 : aucune écriture n'a pu atteindre la base réelle |
| 9. Tests locaux, automatisés, ou données marquées `TEST-QA` | ✅ | 27 suites automatisées ; les jeux d'essai SQL sont préfixés `TEST-QA` et utilisent des adresses en `.test` / `.invalid` |
| 10. Ne jamais désactiver la RLS | ✅ | `grep -rn "disable row level security" migrations/9[2-6]*.sql` → **aucune occurrence**. Les seules du dépôt sont des procédures de retour arrière, **en commentaire**, dans `90`/`91` déjà appliqués. Contrôle en ligne au § 8.2 (e) |
| 11. Ne rendre aucune table ni bucket public | ✅ | `96` crée `missions-photos` avec `public = false` ; contrôle fourni au § 8.2 (d) |
| 12. Ne jamais exposer la clé `service_role` côté navigateur | ✅ | seule la clé `anon` figure dans les pages — décodage réel au § 8.3 |
| 13. Garder `candidatures-videos` privé | ✅ | jamais modifié ; `93` ne change que la taille limite |
| 14. Conserver les jetons signés, temporaires et à usage limité | ✅ | l'envoi reprenable réutilise **le même jeton signé** ; l'action `prolonger` resigne **le chemin déjà autorisé** et ne consomme pas le jeton (§ 5.5) |
| 15. Préserver l'existant (formulaires, multi-véhicules, Dashboard, devis, authentification, missions) | ✅ | suites de non-régression `t_nonreg`, `t_pro`, `t_nettoyage`, `t_dates`, `t_brouillon`, `t_motdepasse`, `t_mdp_ui` |
| 16. En cas d'ambiguïté, étudier l'existant, choisir la solution cohérente, documenter | ✅ | chaque choix est documenté dans le message de commit et dans `migrations/README.md` ; le cas le plus lourd (§ 5.5, l'envoi reprenable) a sa propre note : `tests/RECETTE-ENVOI-REPRENABLE.md` |
| 17. Tests locaux, commits propres, Pull Request ouverte non fusionnée | ✅ | § 4, § 3, et la Pull Request nº 2 |

---

## 3. Tous les commits de la Pull Request nº 2

Dans l'ordre chronologique, du plus ancien au plus récent.

| # | Empreinte | Chantier | Message |
|---|---|---|---|
| 1 | `b7a1b79` | 3 | Corrige l'erreur RLS 42501 sur vehicules et rend la creation atomique |
| 2 | `a1904ac` | 4 | Video : limite 300 Mo et veritable enregistreur dans la page |
| 3 | `4d3b952` | 5 + 8 | Formulaire professionnel : metiers, alignement, validations et delai |
| 4 | `ee98227` | 5 | Section Mission : effacement global confirme et libelle precis |
| 5 | `ff6bf5f` | 6 | Etapes et services independants : le bouton Continuer ne grise plus |
| 6 | `2aea7f1` | 10 | Informations manquantes : ne reclamer que ce qui manque vraiment |
| 7 | `c38651d` | 12 | Blocage partenaire : un seul mecanisme, et il persiste |
| 8 | `71104b5` | 9 | Devis : un seul systeme, reellement disponible pour les quatre services |
| 9 | `b7362be` | 7 | Calendrier de periode : le meme pour le stockage et l'intervention |
| 10 | `33badbf` | 11 | Dashboard : charte HelixCar et fond blanc |
| 11 | `874308a` | 13 | Candidats : plusieurs metiers, et le technicien enfin possible |
| 12 | `f6b81c1` | 14 | Dashboard : plus rien d'invente ne se fait passer pour du reel |
| 13 | `c0e10fc` | 15 | Audit mono / multi-vehicules : la chaine complete, verifiee |
| 14 | `fb89863` | 4 | Envoi video reprenable : un vrai TUS, sans rien affaiblir |
| 15 | `58a64ab` | 4 | Envoi video : pourcentage, annulation et nouvelle tentative |
| 16 | `cf5be0a` | 13 | Candidats : des metiers ajoutes un par un, et retirables |
| 17 | `edbb1e1` | 14 | Nettoyage : une demande devient une mission, avec ses photos |
| 18 | `3b42afc` | tests | Tests : suivre les metiers la ou les activites etaient cochees |
| 19 | `61082c6` | 14 | Photos d'intervention : les voir, et pas seulement les compter |
| 20 | `7808976` | doc | Migrations : la phase D va bien jusqu'a 96 |
| 21 | *(ce document)* | doc | Dossier de recette et de mise en production |

Les deux derniers commits méritent une explication, parce qu'ils sont nés de
la campagne de tests finale et non du cahier des charges :

- **`3b42afc`** — trois suites (`t_video`, `t_tus`, `t_nonreg`) pilotaient
  encore les trois cases à cocher d'activité, supprimées par le chantier nº 13
  au profit des métiers. Elles étaient donc devenues aveugles. **Aucun défaut
  produit** : le formulaire fonctionne, ce sont les tests qui regardaient au
  mauvais endroit. Corrigés, ils repassent au vert (`t_video` 70, `t_tus` 48,
  `t_nonreg` 40).
- **`61082c6`** — en rédigeant la check-list QA, j'ai constaté que le Dashboard
  **comptait** les photos d'intervention sans jamais les **afficher** :
  HelixCar aurait validé une prestation sans voir ce qu'elle valide. La lecture
  a été ajoutée, en réutilisant exactement le mécanisme d'URL signée temporaire
  déjà en place pour les vidéos de candidature. Aucune migration
  supplémentaire : les politiques de `96` accordaient déjà cette lecture.

**Fichiers touchés** — 33 fichiers :

| Fichier | Nature |
|---|---|
| `index.html` | site public et formulaires |
| `dashboard.html` | espace administrateur, partenaire et client |
| `migrations/92` → `96` | **nouvelles migrations, non exécutées** |
| `migrations/README.md` | ordre d'application, vérifications, retours arrière |
| `supabase/functions/candidature-video/index.ts` | fonction serveur (non redéployée) |
| `tests/` | 26 suites navigateur + 1 suite serveur + 1 suite PostgreSQL |
| `RECETTE-LOT.md` | **ce document** |

Aucun fichier de migration déjà appliqué (`00` → `06`, `90`, `91`) n'a été
modifié. Vérifiable en une commande :

```bash
git diff --name-only origin/main..HEAD -- migrations/
```

Sortie réelle obtenue — seuls des fichiers **nouveaux** y figurent :

```
migrations/92_creation_demande_atomique.sql
migrations/93_bucket_video_300mo.sql
migrations/94_informations_selon_scenario.sql
migrations/95_metiers_partenaires.sql
migrations/96_missions_nettoyage.sql
migrations/README.md
```

---

## 4. Tous les tests exécutés, avec leur résultat réel

**Résultat global : 1 276 contrôles, 1 276 PASS, 0 FAIL.**
Tous exécutés le 8 septembre 2026, après le dernier commit de code, en une
seule campagne. Aucun chiffre de ce document n'est estimé ou reporté d'une
exécution antérieure.

### 4.1 Trois familles de preuves, volontairement séparées

1. **PostgreSQL 16 local et jetable** (`tests/t_rls.sh`) — les **vrais**
   fichiers de `migrations/` sont appliqués sans modification, puis le
   comportement est observé pour de bon : ce que voit l'ancien Dashboard, ce
   que voit la nouvelle version, ce que voit un partenaire bloqué, ce que voit
   un client. **Jamais de connexion à Supabase.**
2. **Navigateur réel** (Chromium, Playwright) — 26 suites qui pilotent
   `index.html` et `dashboard.html` comme un utilisateur : clics, saisies,
   changements d'étape, rechargements, coupures réseau.
3. **Code serveur exécuté** (`t_video_securite.mjs`) — le vrai code de la
   fonction `candidature-video` est exécuté contre un double Supabase, pour
   éprouver le jeton, le chemin imposé, l'usage unique et le cloisonnement.

### 4.2 Résultats réels, suite par suite

#### Politiques RLS sur PostgreSQL 16 local

| Suite | PASS | FAIL | Ce qu'elle applique et observe |
|---|---|---|---|
| `t_rls.sh` | **169** | 0 | Les **vrais** fichiers `migrations/00` → `96` appliqués sans modification sur une base jetable, puis 12 séries d'observations |

Les 12 sections, dans l'ordre où elles s'exécutent :

| Section | Ce qu'elle prouve |
|---|---|
| **A** | La phase préparatoire (`00`→`06`) reste compatible avec l'**ancien** Dashboard |
| **B** | Effet réel du durcissement (`90`, `91`) : lecture vide et écriture silencieuse pour un appelant anonyme |
| **C** | Ce que voit un partenaire **non bloqué** |
| **D** | Ce que voit un partenaire **bloqué** : fiche visible, **zéro mission**, auto-déblocage impossible, décisions conservées |
| **E** | Déblocage par l'administrateur, et retour à l'état normal |
| **G** | Espace client : cloisonnement entre clients, informations réclamées |
| **H** | Réponse du client, puis validation par l'administrateur |
| **V** | **Chantier nº 3** — l'erreur 42501 sur `vehicules` reproduite, y compris la **création partielle**, puis corrigée par `92` |
| **W** | **Chantier nº 10** — informations réellement manquantes, selon le scénario |
| **X** | **Chantier nº 13** — métiers déclarés, activité `technicien` acceptée, décisions créées **en attente** |
| **Y** | **Chantier nº 14** — missions de nettoyage, photos d'intervention, bucket privé et ses politiques |
| **F** | **Idempotence** : la chaîne complète rejouée une seconde fois — aucune erreur, aucune politique en double, aucun trigger en double, aucune ligne d'historique inventée |

#### Navigateur réel et code serveur

| Suite | PASS | FAIL | Ce qu'elle couvre |
|---|---|---|---|
| `t_nettoyage` | **28** | 0 | Parcours Nettoyage complet, du service au récapitulatif |
| `t_contact` | **20** | 0 | Contact sur place : moi-même / une autre personne |
| `t_pro` | **54** | 0 | Trouver un professionnel : catégories, compteurs, véhicules, récap, envoi |
| `t_pro_ui` | **32** | 0 | Formulaire professionnel : métiers, alignement, effacement confirmé, validations |
| `t_etapes` | **14** | 0 | **§ 6** — le bouton Continuer ne se grise jamais ; une branche inactive ne bloque rien |
| `t_dates` | **19** | 0 | Calendriers liés, bornes, horaires même jour et multi-jours |
| `t_periode` | **40** | 0 | **§ 7** — un seul calendrier début/fin, plage colorée, bornes, heures, Effacer limité |
| `t_devis` | **40** | 0 | Devis PDF des 3 services + non-régression du devis convoyage |
| `t_devis_commun` | **52** | 0 | **§ 9** — devis réellement disponible pour les 4 services, un seul moteur |
| `t_brouillon` | **20** | 0 | Effacer / OK par rubrique, brouillon restauré après F5 |
| `t_nonreg` | **40** | 0 | **Non-régression** : convoyage, stockage, compte seul, partenaire, textes, périmètre du diff |
| `t_video` | **70** | 0 | **§ 4** — exigence et durée selon les métiers, formats, taille, remplacement, envoi, erreurs réseau |
| `t_enregistreur` | **26** | 0 | **§ 4** — véritable enregistreur dans la page (caméra, chronomètre, relecture) |
| `t_tus` | **48** | 0 | **§ 4** — envoi reprenable contre un vrai serveur TUS : découpage, reprise à l’octet, resignature, repli |
| `t_video_admin` | **27** | 0 | Dashboard : états de la vidéo, lecture par URL signée, nettoyage à la fermeture |
| `t_video_securite` | **55** | 0 | **Sécurité serveur** : vrai code de `candidature-video` (jeton, chemin imposé, usage unique, cloisonnement) |
| `t_decisions` | **53** | 0 | Décisions par activité, six transitions, historique, persistance, refus d’autorisation |
| `t_blocage` | **35** | 0 | **§ 12** — état affiché = état enregistré, motif et date, persistance après rechargement dans les deux sens |
| `t_client` | **34** | 0 | Espace client : session réelle, nouvelle demande, profil prérempli, F5, coupure réseau |
| `t_infos` | **45** | 0 | **§ 10** — rubriques manquantes uniquement, transmission, validation administrateur, garde-fous |
| `t_motdepasse` | **33** | 0 | Réinitialisation du mot de passe, de bout en bout |
| `t_mdp_ui` | **88** | 0 | Longueur minimale et bouton œil sur les six champs |
| `t_charte` | **34** | 0 | **§ 11** — palette comparée valeur par valeur sur les styles **réellement calculés**, fond blanc |
| `t_metiers` | **37** | 0 | **§ 13** — métiers cumulables, badges retirables, aucun métier fantôme, nomenclature partagée |
| `t_nettoyage_dashboard` | **43** | 0 | **§ 14** — tentative réelle de contournement de la connexion, chiffres réellement lus, plus rien de fictif |
| `t_mission_nettoyage` | **72** | 0 | **§ 14** — fiche complète, création de la mission, cloisonnement par métier, photos avant/après **et leur relecture signée**, validation |
| `t_multivehicules` | **48** | 0 | **§ 15** — la même demande de la saisie au PDF et à la fiche admin, aucun mélange entre véhicules |
| **Total** | **1 107** | **0** | 26 suites navigateur + 1 suite serveur |

#### Somme

| Famille | PASS | FAIL |
|---|---|---|
| PostgreSQL 16 local (`t_rls.sh`) | 169 | 0 |
| Navigateur réel + code serveur | 1 107 | 0 |
| **Total** | **1 276** | **0** |

### 4.3 Ce que la campagne a rattrapé

Cette exécution complète n'était pas une formalité : **elle a trouvé deux
défauts réels**, tous deux corrigés avant la remise (§ 3, commits `3b42afc` et
`61082c6`). C'est la raison pour laquelle les chiffres ci-dessus proviennent
d'une campagne lancée **après** le dernier commit de code, et non d'un cumul
d'exécutions passées.

---

## 5. Blocages techniques démontrés

Ce ne sont pas des suppositions : chacun a été constaté puis contourné sans
affaiblir la sécurité.

### 5.1 L'environnement de développement ne peut pas joindre Supabase

Toute sortie réseau vers `supabase.com` est refusée depuis l'environnement de
travail. **Conséquence assumée : aucun test n'a pu écrire dans le projet
réel — ce qui est exactement la garantie demandée.** Le contournement retenu
est plus exigeant qu'un test contre la production : les fichiers de
`migrations/` sont appliqués **tels quels** sur un PostgreSQL 16 local jetable,
avec les rôles `anon` et `authenticated` reconstitués, et le comportement est
mesuré. Limite honnête : le socle local reproduit **les colonnes dont dépendent
les migrations**, pas le schéma complet de production. Un écart reste possible,
d'où les contrôles à passer sur Supabase après application (§ 8).

### 5.2 Les bibliothèques chargées depuis un CDN sont injoignables

`supabase-js` et `jsPDF` sont chargés depuis un CDN, hors d'atteinte ici.
Contournement : des **doubles instrumentés** injectés avant le chargement de la
page. Le code testé reste le vrai code de la page.
**Ce que cela laisse à faire manuellement** : ouvrir un devis PDF réellement
généré et le relire à l'œil (§ 7, point 6). Les tests prouvent *ce qui est
écrit dedans*, pas *comment cela s'imprime*.

### 5.3 MP4 et MOV ne sont pas décodables par le Chromium de test

Cette build est dépourvue des codecs propriétaires : `canPlayType` renvoie une
chaîne vide pour `video/mp4` et `video/quicktime`. La lecture de **durée**
n'est donc éprouvée de bout en bout qu'en **WebM**. Pour MP4 et MOV, la couche
d'acceptation (type MIME, extension de stockage, refus d'un fichier non
décodable) est testée, mais **une vérification manuelle sur un vrai téléphone
reste nécessaire** (§ 7, point 8, et `tests/RECETTE-VIDEO.md`).

### 5.4 La limite globale de taille de fichier Supabase n'est pas réglable en SQL

La migration `93` porte la limite du bucket `candidatures-videos` à 300 Mo,
mais Supabase applique **en plus** une limite globale au projet. Tant que
celle-ci reste à 50 Mo, **c'est elle qui s'applique** : une vidéo de 200 Mo
serait refusée malgré la migration. Ce réglage n'existe que dans l'interface.
→ **Action manuelle obligatoire**, § 6, étape 3.

### 5.5 L'envoi reprenable (TUS) ne pouvait pas être validé contre Supabase

Le besoin — reprendre un envoi de 300 Mo interrompu — impose la route
reprenable de Supabase Storage. Impossible à interroger d'ici. Deux preuves
ont donc été construites :

1. **Lecture des sources officielles de Supabase Storage**, récupérées depuis
   GitHub, qui établissent que la route reprenable accepte **le même jeton
   d'envoi signé** que la route simple. Citations et références dans
   `tests/RECETTE-ENVOI-REPRENABLE.md`.
   **Conséquence : aucun compromis de sécurité n'a été nécessaire.** Le
   navigateur ne reçoit toujours aucune clé privilégiée, le dépôt reste
   soumis à un jeton signé, temporaire et à usage limité, et le bucket reste
   privé.
2. **Un vrai serveur TUS local**, contre lequel le vrai code d'envoi de
   `index.html` a été exécuté : découpage en morceaux, coupure en cours,
   reprise à l'octet exact, renouvellement de la signature en cours de route,
   reprise après rechargement complet de la page, et repli automatique sur
   l'envoi simple si la route reprenable est absente.

**Ce qui reste à confirmer en ligne** : que le projet Supabase expose bien
`/storage/v1/upload/resumable`. Si ce n'était pas le cas, le code **ne casse
pas** : il bascule seul sur l'envoi en une requête (repli testé). § 7, point 9.

### 5.6 Une politique RLS qui interroge une table protégée cesse silencieusement de correspondre

Rencontré **trois fois** dans ce lot. Le cas le plus grave est le chantier
nº 3 : après le durcissement, la politique d'insertion de `public.vehicules`
vérifiait l'existence du dossier parent dans `public.clients` — devenue
invisible au visiteur anonyme. Résultat mesuré sur PostgreSQL 16 :
**la demande était écrite, ses véhicules non**. Une demande sur deux serait
arrivée amputée, sans erreur visible côté client.

Correctif : des fonctions `security definer` dédiées
(`est_proprietaire_demande`, `est_partenaire_de_mission`) et une création
**atomique** (`creer_demande_avec_vehicules`) — migration `92`, qui est donc
**obligatoire** et doit suivre la phase C de très près.

### 5.7 Un accès sans authentification était encore possible dans le Dashboard

Découvert pendant le chantier nº 14 : une clé de démonstration laissée dans le
navigateur (`localStorage`) ouvrait l'application **avec un rôle, sans aucune
authentification**. Supprimée, et la clé résiduelle est effacée au chargement.
Ce point n'était pas demandé : il est signalé ici parce qu'il touche la
sécurité.

### 5.8 Aucun e-mail réel ne peut être envoyé, et c'est vérifié

Le lot ne devait envoyer aucun e-mail. Ce n'est pas seulement « non
implémenté » : **douze suites surveillent les appels EmailJS** et échouent si un seul
part : `t_blocage`, `t_client`, `t_decisions`, `t_devis_commun`, `t_infos`,
`t_mdp_ui`, `t_mission_nettoyage`, `t_motdepasse`, `t_multivehicules`,
`t_nettoyage_dashboard`, `t_nonreg`, `t_video`.

---

## 6. Instructions manuelles à exécuter, dans l'ordre exact

> **Rien de ce qui suit n'a été fait à votre place.** Aucune migration n'a été
> exécutée, aucun déploiement déclenché, la Pull Request nº 2 n'est pas
> fusionnée.

**Rappel de contexte** : les migrations `00` → `06` (phase A), ainsi que `90` et
`91` (phase C), sont **déjà appliquées** sur votre projet. Il reste donc la
**phase D** — les fichiers `92` à `96` — puis les réglages et les déploiements.

L'ordre ci-dessous est **impératif**. Chaque étape se termine par un contrôle :
**ne passez à la suivante que si le contrôle est vert.**

---

### Étape 0 — Sauvegarde (5 minutes)

Supabase → **Database → Backups** → déclencher une sauvegarde manuelle et
**noter son horodatage**. C'est le point de retour du § 9.

*Contrôle* : la sauvegarde apparaît dans la liste, avec l'heure du jour.

---

### Étape 1 — Correctif critique : la migration `92` (2 minutes)

C'est le chantier nº 3 : aujourd'hui, en production, une demande peut être
enregistrée **sans ses véhicules**, sans aucune erreur visible. Ne l'attendez
pas — cette migration n'ajoute qu'une fonction et ne casse rien de l'existant.

Supabase → **SQL Editor** → coller **l'intégralité** de
`migrations/92_creation_demande_atomique.sql` → *Run*.

*Contrôle* :
```sql
select count(*) from pg_proc
 where proname = 'creer_demande_avec_vehicules';
-- doit renvoyer 1
```

---

### Étape 2 — Migrations `93`, `94`, `95`, `96` (10 minutes)

**Un fichier à la fois, dans cet ordre, en vérifiant chaque fois.**

| Ordre | Fichier | Ce que ça fait | Contrôle à passer juste après |
|---|---|---|---|
| 2.1 | `93_bucket_video_300mo.sql` | porte la limite du bucket vidéo à 300 Mo | `select file_size_limit from storage.buckets where id = 'candidatures-videos';` → **314572800** |
| 2.2 | `94_informations_selon_scenario.sql` | ne réclame au client que ce qui manque **vraiment**, selon son scénario | `select count(*) from pg_proc where proname = 'hc_texte';` → **1** |
| 2.3 | `95_metiers_partenaires.sql` | les candidats peuvent déclarer plusieurs métiers ; l'activité « technicien » devient possible | `select count(*) from information_schema.columns where table_name='convoyeurs' and column_name='metiers';` → **1** |
| 2.4 | `96_missions_nettoyage.sql` | les missions de nettoyage et leurs photos avant/après | `select count(*) from storage.buckets where id = 'missions-photos';` → **1** |

*Contrôle global de fin d'étape* :
```sql
select id, public from storage.buckets
 where id in ('candidatures-videos', 'missions-photos');
-- les DEUX lignes doivent afficher public = false
```
**Si l'une des deux affiche `true`, arrêtez-vous et corrigez** : un bucket
public exposerait des vidéos de candidature ou des photos de véhicules.

---

### Étape 3 — Limite globale de taille de fichier (2 minutes) — **obligatoire**

Supabase → **Storage → Settings → Upload file size limit** → porter à
**300 Mo minimum**.

Sans cette étape, la migration `93` **reste sans effet** : c'est la limite
globale, plus basse, qui s'applique, et une vidéo de 200 Mo est refusée. Ce
réglage n'existe pas en SQL.

*Contrôle* : la valeur affichée dans l'interface est bien ≥ 300 Mo.

---

### Étape 4 — Redéployer la fonction serveur `candidature-video` (5 minutes)

Elle a été modifiée dans ce lot : durée de validité de l'URL d'envoi portée à
30 minutes, activité « technicien » prise en charge, et une nouvelle action
`prolonger` qui **resigne uniquement le chemin déjà autorisé** — c'est ce qui
permet à un envoi de 300 Mo de durer plus de 30 minutes sans jamais donner au
navigateur le droit de choisir où il écrit.

```bash
supabase functions deploy candidature-video
```

**À faire avant le déploiement Vercel** : sans cette version, un envoi long
échouerait au bout de 30 minutes.

**La clé `service_role` reste dans l'environnement des Edge Functions et nulle
part ailleurs.** Ne la copiez dans aucun fichier du dépôt.

*Contrôle* : Supabase → **Edge Functions → candidature-video** → la date de
déploiement est celle du jour.

---

### Étape 5 — Fusionner la Pull Request nº 2 (2 minutes)

Une fois les étapes 0 à 4 vertes : GitHub → Pull Request nº 2 → **Merge**.

Si Vercel est branché sur la branche principale, **la fusion déclenche le
déploiement**. C'est voulu : la base est déjà prête à ce moment-là.

---

### Étape 6 — Vérifier le déploiement Vercel (5 minutes)

Vercel → le déploiement du jour est en **Ready**, sans erreur de build.
Ouvrir https://helixcar-i89b.vercel.app/ et forcer le rechargement complet
(Ctrl+Maj+R, ou Cmd+Maj+R sur Mac) pour écarter le cache du navigateur.

---

### Étape 7 — Réglages Supabase déjà documentés, à revérifier

Ces points ne changent pas dans ce lot, mais un contrôle rapide évite une
mauvaise surprise (détail complet dans `migrations/README.md`) :

- **Authentication → URL Configuration** : `Site URL` =
  `https://helixcar-i89b.vercel.app`, et `https://helixcar-i89b.vercel.app/dashboard.html`
  dans les *Redirect URLs* (sinon le lien de réinitialisation du mot de passe
  retombe sur la page d'accueil).
- **Authentication → Providers → Email → Minimum password length** = **8**.
- **Conservation des vidéos de candidature** : durée définie et mentionnée dans
  la politique de confidentialité.

---

## 7. Check-list QA détaillée, pour un non-développeur

À passer **sur le site en ligne, après l'étape 6**. Aucune connaissance
technique n'est requise. Prévoyez **une heure**.

**Deux règles à tenir absolument :**
- Utilisez des données de test reconnaissables : nom **`TEST-QA Dupont`**,
  e-mail en `@exemple.invalid`, ville `TEST-QA Ville`.
- **Ne bloquez aucun partenaire réel, ne validez aucune vraie candidature, ne
  supprimez aucune vraie demande.** Créez vos propres lignes de test.

À la fin, supprimez vos lignes `TEST-QA` depuis le Dashboard administrateur.

---

### 7.1 Le point critique : une demande à plusieurs véhicules *(chantier 3 et 15)*

C'est le contrôle le plus important de la liste.

1. Sur le site public, demander un **Convoyage** avec **3 véhicules**, chacun
   avec une **plaque différente et facilement reconnaissable** (par exemple
   `TESTQA-AA`, `TESTQA-BB`, `TESTQA-CC`), et des **adresses de départ et
   d'arrivée différentes** pour chacun.
2. Aller jusqu'au bout et valider.
3. **☐ La confirmation s'affiche, avec un numéro de demande.**
4. Dashboard administrateur → ouvrir cette demande.
5. **☐ Les 3 véhicules sont présents.** *(Si un seul apparaît, ou aucun, la
   migration `92` n'a pas été appliquée — revenez à l'étape 1 du § 6.)*
6. **☐ Chaque véhicule affiche SA plaque, SES adresses, SES dates.** Aucune
   information d'un véhicule ne doit apparaître sur un autre.
7. Générer le **devis PDF** de cette demande.
8. **☐ Le PDF contient bien 3 blocs « VÉHICULE », avec les bonnes plaques,
   dans le bon ordre.**
9. Refaire l'opération avec **un seul véhicule**.
   **☐ Aucune mention « Véhicule 1 » superflue** : quand il n'y en a qu'un, on
   ne numérote pas.

---

### 7.2 Les quatre formulaires vont jusqu'au bout *(chantiers 5 et 6)*

Pour **chacun** des quatre services — **Convoyage**, **Stockage**,
**Nettoyage**, **Trouver un professionnel automobile** :

1. **☐ Le bouton « Continuer » n'est jamais grisé.** S'il refuse d'avancer, il
   affiche **un message qui dit précisément ce qui manque**.
2. **☐ Remplir une seule branche suffit.** Choisir Nettoyage ne doit pas
   réclamer des informations de Convoyage.
3. **☐ Le récapitulatif final reprend exactement ce qui a été saisi.**
4. **☐ Le délai annoncé est « sous 1 heure »** — plus aucune mention de
   « sous 2 heures » nulle part sur le site.

Pour **Trouver un professionnel automobile** en particulier :

5. **☐ Les métiers proposés sont cohérents et alignés proprement.**
6. **☐ Le bouton « Tout effacer » demande confirmation** avant d'effacer.

---

### 7.3 Le calendrier de période *(chantier 7)*

Sur **Stockage** (dates de début et de fin), puis sur **une intervention** :

1. **☐ Un seul calendrier** sert pour le début et pour la fin.
2. Cliquer une date de début, puis une date de fin.
   **☐ Toute la période entre les deux est colorée.**
3. **☐ Les dates antérieures à aujourd'hui sont grisées et non cliquables.**
4. **☐ Une heure de début ET une heure de fin peuvent être saisies.**
5. Cliquer **« Effacer »**.
   **☐ Seules les dates sont effacées** — le reste du formulaire est intact.

---

### 7.4 Le devis, pour les quatre services *(chantier 9)*

Pour **chacun** des quatre services, depuis le Dashboard administrateur :

1. **☐ Le bloc « Devis » est présent dans la fiche.** *(Avant ce lot, il
   n'existait que pour le convoyage.)*
2. Générer le PDF.
   **☐ Il s'ouvre, et l'objet correspond au bon service** (« Nettoyage de
   véhicules », « Stockage de véhicules », etc. — jamais « Convoyage » par
   défaut).
3. **☐ Le nombre de véhicules et le libellé du prix sont ceux du service.**
4. **☐ Relire le PDF à l'œil** : mise en page, chevauchements, débordements.
   *(C'est le point que les tests automatiques ne peuvent pas couvrir — voir
   § 5.2.)*

---

### 7.5 Les informations réclamées au client *(chantier 10)*

1. Créer une demande de **Convoyage** en laissant volontairement de côté le
   **contact à la livraison**.
2. Dashboard → **☐ la demande apparaît comme incomplète**, et **seul le contact
   à la livraison** est réclamé.
3. **☐ Rien d'autre n'est réclamé** — surtout pas une information déjà donnée,
   ni une information sans objet pour ce scénario.
4. Créer une demande de **Stockage avec acheminement par le client** :
   **☐ HelixCar ne réclame PAS l'adresse de prise en charge** (c'est le client
   qui apporte le véhicule).
5. Côté client, ouvrir l'onglet **« Informations à compléter »**, répondre.
   **☐ Après envoi, la demande n'est plus signalée comme incomplète.**

---

### 7.6 Les couleurs du Dashboard *(chantier 11)*

1. Ouvrir le Dashboard.
2. **☐ Le fond est BLANC** — pas beige, pas gris.
3. **☐ Les couleurs sont celles du site public** (le rouge HelixCar, l'encre
   sombre, l'argent). Ouvrez les deux pages côte à côte pour comparer.
4. **☐ Les cartes et les tableaux ont un contour visible** sur le fond blanc.
5. **☐ Aucun texte gris clair illisible.**
6. **☐ À vérifier aussi sur téléphone.**

---

### 7.7 Bloquer et débloquer un partenaire *(chantier 12)*

**Créez d'abord un partenaire de test `TEST-QA`. Ne touchez à aucun partenaire
réel.**

1. Dashboard administrateur → fiche du partenaire de test → **Bloquer**.
2. **☐ Un motif est demandé avant toute écriture**, et le blocage est **refusé
   tant qu'aucun motif n'est choisi.**
3. **☐ La fiche affiche « Bloqué », avec le motif et la date.**
4. **☐ Dans la liste, le partenaire porte aussi le badge « Bloqué ».**
5. **Recharger complètement la page (Ctrl+Maj+R).**
   **☐ Il est TOUJOURS affiché comme bloqué.** *(C'était le défaut : l'état
   s'affichait sans être enregistré.)*
6. Se connecter avec le compte du partenaire bloqué.
   **☐ Il ne voit AUCUNE mission.**
   **☐ Il ne peut pas se débloquer lui-même.**
7. Revenir en administrateur → **Débloquer**.
8. **Recharger complètement.** **☐ Il est de nouveau actif.**
9. **☐ Ses décisions et son historique sont intacts.**
10. **☐ Aucun e-mail n'est parti** (vérifiez la boîte de réception du compte de
    test : elle doit rester vide).

---

### 7.8 Les métiers des candidats *(chantier 13)*

1. Site public → candidature partenaire.
2. **☐ Un bouton « + » permet d'ajouter les métiers un par un.**
3. Ajouter **trois métiers** de familles différentes.
   **☐ Chacun apparaît comme un badge.**
4. **☐ Chaque badge peut être retiré individuellement**, sans effacer les
   autres.
5. **☐ Un même métier ne peut pas être ajouté deux fois.**
6. Ajouter un métier de **technicien**.
   **☐ La candidature est acceptée.** *(Si elle est refusée avec une erreur de
   base, la migration `95` n'a pas été appliquée.)*
7. **☐ La vidéo est demandée ou non selon les métiers choisis**, avec la bonne
   durée.
8. Dashboard administrateur → fiche du candidat.
   **☐ Les trois métiers apparaissent, avec les mêmes libellés que dans le
   formulaire.**
9. Espace partenaire → profil.
   **☐ Les métiers déclarés y figurent.**

---

### 7.9 Le nettoyage : de la demande à la mission *(chantier 14)*

1. Site public → une demande de **Nettoyage** `TEST-QA`.
2. Dashboard administrateur → ouvrir la demande.
   **☐ La fiche affiche la prestation, les options, le parc, la date, le lieu,
   le prix client et la rémunération du partenaire.**
3. **☐ Un bouton permet de créer une mission de nettoyage** depuis la demande.
4. Créer la mission. **☐ Elle reçoit une référence `HC-NET-…`.**
5. Attribuer la mission à un **partenaire de test** dont le métier est le
   nettoyage.
6. Se connecter avec ce partenaire.
   **☐ Il voit la mission.**
   **☐ Un partenaire d'un AUTRE métier ne la voit pas.**
7. Depuis le compte partenaire, déposer une **photo « avant »** puis une
   **photo « après »**.
   **☐ Les compteurs des deux boutons passent à 1.**
8. Partenaire → **« Voir les photos »**.
   **☐ Les deux photos s'affichent**, en deux colonnes *Avant* / *Après*, avec
   leur date.
9. **☐ Un partenaire d'une AUTRE mission ne voit pas ces photos.**
10. **Le contrôle de confidentialité, à faire absolument.** Dans la fenêtre des
    photos, clic droit sur une image → *Copier l'adresse de l'image*. Coller
    cette adresse dans une **fenêtre de navigation privée** :
    **☐ l'image s'affiche d'abord** (le lien est signé pour 5 minutes), puis
    **☐ au bout de 5 minutes, la même adresse doit être REFUSÉE.**
    C'est la preuve que le stockage est privé et que l'accès est temporaire.
11. Partenaire → **Terminer l'intervention**.
    **☐ Le bouton n'est actif qu'après au moins une photo avant ET une après.**
    **☐ Le statut change.**
12. Administrateur → liste des missions → **« 📷 Photos »** sur la mission.
    **☐ Les mêmes photos s'affichent.** *(C'est ce qui permet de valider sur
    pièces plutôt qu'à l'aveugle.)*
13. Administrateur → **Valider la prestation**.
    **☐ La validation est enregistrée, avec sa date.**
14. **☐ Le bouton « 📷 Photos » reste disponible après la validation** — ces
    images constatent l'état des véhicules, elles ne disparaissent pas.

---

### 7.10 La vidéo de candidature *(chantier 4)*

**À faire sur un vrai téléphone, en 4G ou 5G** — c'est là que les envois
échouent, et c'est précisément ce que ce chantier corrige.

1. Candidature partenaire → arriver à l'étape vidéo.
2. **☐ Deux boutons distincts** : *importer un fichier* et *enregistrer
   maintenant*.
3. **Enregistrer maintenant** :
   **☐ La caméra s'ouvre dans la page**, l'aperçu est visible, l'enregistrement
   démarre et s'arrête, la vidéo est relisible avant envoi.
4. **☐ On peut recommencer l'enregistrement** sans repartir de zéro.
5. **Importer un fichier** :
   **☐ Une vidéo MP4 acceptée** (voir § 5.3 : ce format n'a pas pu être testé
   automatiquement, ce contrôle manuel est donc **indispensable**).
   **☐ Une vidéo MOV acceptée** (iPhone).
   **☐ Une vidéo de plus de 300 Mo refusée, avec un message clair.**
   **☐ Une vidéo de 200 Mo ACCEPTÉE.** *(Si elle est refusée, l'étape 3 du § 6
   — la limite globale — n'a pas été faite.)*
6. **Pendant l'envoi** :
   **☐ Un pourcentage progresse réellement.**
   **☐ Le bouton « Annuler » fonctionne.**
   **☐ Après une annulation, « Réessayer » relance l'envoi.**
7. **Le test de reprise, le plus utile** : lancer l'envoi d'une grosse vidéo,
   **activer le mode avion pendant 30 secondes**, puis le désactiver.
   **☐ L'envoi repart de là où il s'était arrêté**, pas de zéro.
8. **Le test de reprise après rechargement** : lancer un envoi, **recharger la
   page** à mi-parcours, revenir sur la candidature.
   **☐ L'envoi peut reprendre.**
9. Dashboard administrateur → fiche du candidat.
   **☐ La vidéo se lit.**
   **☐ Copier l'adresse de la vidéo et l'ouvrir en navigation privée : l'accès
   doit être REFUSÉ** (l'adresse est temporaire et signée).

---

### 7.11 Rien n'a été cassé *(non-régression)*

1. **☐ Se connecter en administrateur, en partenaire, en client** — les trois
   fonctionnent.
2. **☐ Les chiffres de la page d'accueil du Dashboard correspondent à la
   réalité** (comparez avec les listes).
3. **☐ Aucun écran n'affiche de données de démonstration.**
4. **☐ Dans le navigateur, en navigation privée, ouvrir `/dashboard.html` sans
   se connecter : aucun espace ne doit s'ouvrir.** *(Voir § 5.7.)*
5. **☐ La réinitialisation du mot de passe fonctionne** de bout en bout.
6. **☐ Le bouton « œil » affiche et masque le mot de passe** sur les six
   champs concernés.
7. **☐ Un ancien utilisateur dont le mot de passe fait moins de 8 caractères
   peut toujours se connecter.**

---

## 8. Que tester, et à quel moment

### 8.1 AVANT toute migration — sur votre poste, rien n'est touché en ligne

Ces tests s'exécutent sur les fichiers du dépôt, **sans jamais joindre
Supabase**. C'est le filet de sécurité avant de toucher à quoi que ce soit.

```bash
# 1. Les politiques RLS, appliquées pour de vrai sur un PostgreSQL 16 jetable.
#    Requiert postgresql-16 et les droits root. Ne joint JAMAIS Supabase.
bash tests/t_rls.sh

# 2. Les 26 suites navigateur, depuis la racine du dépôt.
for f in tests/t_*.js; do echo "== $f"; node "$f" || echo "ÉCHEC $f"; done

# 3. La sécurité de la fonction serveur.
node tests/t_video_securite.mjs
```

C'est exactement la commande qui a produit les chiffres du § 4.2.

**Attendu : `0 FAIL` partout.** Si une suite échoue, **n'appliquez aucune
migration** et signalez-le.

Et sur Supabase, deux relevés **à noter avant de commencer** — ils servent de
référence pour vérifier ensuite que rien n'a été perdu :

```sql
select count(*) from public.clients;
select count(*) from public.vehicules;
select count(*) from public.convoyeurs;
select count(*) from public.missions;
select count(*) from public.convoyeur_decisions;
```

---

### 8.2 APRÈS les migrations (§ 6, étapes 1 et 2), avant tout déploiement

**a) Les contrôles de chaque migration** sont dans le tableau du § 6, étape 2 :
passez-les un par un.

**b) Aucune donnée n'a été perdue** — rejouer les cinq `count(*)` du § 8.1 :

```sql
-- Chaque nombre doit être IDENTIQUE ou SUPÉRIEUR au relevé initial.
-- Un nombre en BAISSE est une anomalie : arrêtez-vous et allez au § 9.
select count(*) from public.clients;
select count(*) from public.vehicules;
select count(*) from public.convoyeurs;
select count(*) from public.missions;
select count(*) from public.convoyeur_decisions;
```

**c) Aucune décision n'a été inventée** — la migration `95` crée les décisions
manquantes, et elle doit les créer **en attente**, jamais accordées :

```sql
select decision, count(*) from public.convoyeur_decisions
 where activite = 'technicien' group by decision;
-- Attendu : uniquement 'en_attente'.
-- Aucune ligne 'oui' ne doit apparaître du seul fait de la migration.
```

**d) Les deux buckets sont privés** :

```sql
select id, public, file_size_limit from storage.buckets
 where id in ('candidatures-videos', 'missions-photos');
-- public = false pour les DEUX. C'est bloquant.
```

**e) La RLS n'a été désactivée nulle part** :

```sql
select relname from pg_class
 where relnamespace = 'public'::regnamespace
   and relkind = 'r' and relrowsecurity = false
   and relname in ('clients','vehicules','convoyeurs','missions',
                   'convoyeur_decisions','convoyeur_decisions_historique',
                   'demande_informations_manquantes','mission_photos');
-- Doit ne renvoyer AUCUNE ligne : ces huit tables ont toutes la RLS active.
```

**f) L'ancien site fonctionne toujours** — à ce stade, l'ancienne version est
encore en ligne. Déposer une demande simple sur le site public et vérifier
qu'elle arrive dans le Dashboard. Les migrations de la phase D sont additives :
rien ne doit changer pour l'utilisateur.

---

### 8.3 APRÈS la fusion de la Pull Request (§ 6, étape 5)

La fusion ne change rien en ligne tant que le déploiement n'est pas terminé.
Deux contrôles :

1. **☐ Vercel a bien lancé un déploiement**, et il finit en **Ready**.
2. **☐ Le build ne contient aucune erreur.**

Et un contrôle qui ne coûte rien mais protège beaucoup :

```bash
# Aucune clé privilégiée ne doit se trouver dans les fichiers envoyés au navigateur.
# La commande décode chaque clé Supabase présente et affiche son rôle.
for f in index.html dashboard.html; do
  echo "== $f"
  grep -o 'eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*' "$f" | sort -u | while read t; do
    echo "$t" | cut -d. -f2 | sed 's/$/==/' | base64 -d 2>/dev/null | grep -o '"role":"[a-z_]*"'
  done
done
```

Sortie réelle obtenue sur cette branche :

```
== index.html
  "role":"anon"
== dashboard.html
  "role":"anon"
```

**Seule la clé `anon` figure dans les pages — c'est ce qui est attendu.** Si
`"role":"service_role"` apparaissait, il faudrait **arrêter immédiatement le
déploiement et révoquer la clé** dans Supabase.

> Le mot `service_role` apparaît par ailleurs **quatre fois** dans ces deux
> fichiers, uniquement dans des **commentaires** qui rappellent que cette clé
> ne doit jamais s'y trouver. Ce ne sont pas des clés.

---

### 8.4 APRÈS le déploiement Vercel (§ 6, étape 6)

**Dans cet ordre**, du plus critique au plus confortable :

| Priorité | Contrôle | Où |
|---|---|---|
| 🔴 **1** | Une demande à **3 véhicules** arrive complète | § 7.1 |
| 🔴 **2** | Les **deux buckets refusent** un accès direct sans URL signée | § 7.9 point 10, § 7.10 point 9 |
| 🔴 **3** | Un partenaire **bloqué le reste après rechargement** | § 7.7 |
| 🟠 **4** | Une vidéo de **200 Mo passe**, une de 300 Mo+ est refusée | § 7.10 point 5 |
| 🟠 **5** | Une candidature **technicien** est acceptée | § 7.8 point 6 |
| 🟠 **6** | Une **mission de nettoyage** se crée depuis une demande | § 7.9 |
| 🟡 **7** | Les **quatre devis PDF** s'ouvrent et sont lisibles | § 7.4 |
| 🟡 **8** | Le **fond du Dashboard est blanc** | § 7.6 |
| 🟡 **9** | La **reprise d'un envoi vidéo** après coupure réseau | § 7.10 point 7 |
| 🟢 **10** | Le reste de la check-list du § 7 | § 7 |

**Si l'un des trois contrôles rouges échoue : arrêtez la recette et appliquez
le § 9.**

Enfin, **surveillez la première journée** : Supabase → **Logs → API**, filtrer
sur le code `42501` (refus RLS). Un pic signalerait une politique trop stricte.
Ce code doit rester rare et concerner des tentatives illégitimes.

---

## 9. Procédures de retour arrière

Chaque niveau est indépendant. **Commencez toujours par le moins destructeur.**

### 9.1 Revenir en arrière sur le site seul (2 minutes) — sans toucher à la base

C'est la manœuvre à faire en premier dans presque tous les cas.

Vercel → **Deployments** → le déploiement précédent → **… → Promote to
Production** (ou *Rollback*).

Le site revient à l'état d'avant, **la base n'est pas touchée**.

⚠️ **Une seule précaution** : si la migration `92` est appliquée et que vous
revenez à l'ancienne `index.html`, vous retrouvez le défaut critique du
chantier nº 3 (demandes enregistrées sans leurs véhicules). `92` ne le
provoque pas — c'est le durcissement déjà en place qui le provoque, et `92` le
corrige. **Ne restez pas dans cet état plus que le temps de comprendre le
problème.**

### 9.2 Revenir en arrière sur les migrations, fichier par fichier

**Aucune de ces migrations ne détruit de données.** Il n'y a donc, dans la
plupart des cas, rien à défaire. Le tableau ci-dessous dit, pour chacune, ce
qu'il faut faire — et surtout ce qu'il ne faut **pas** faire.

| Fichier | Retour arrière | Perte de données ? |
|---|---|---|
| `96` | **Laisser en place** les colonnes de `public.missions` et la table `mission_photos` : ce sont des missions et des pièces justificatives réellement créées. Seules les politiques Storage peuvent être retirées (SQL en fin de fichier). | Supprimer la table **effacerait les photos d'état des véhicules**. |
| `95` | **Laisser `convoyeurs.metiers` en place** (colonne facultative, ignorée par l'ancienne version). Ne revenir sur la contrainte que si `select count(*) from public.convoyeur_decisions where activite = 'technicien'` renvoie **0**. | Supprimer la colonne **effacerait des métiers réellement déclarés**. |
| `94` | Réappliquer `06_informations_manquantes.sql` : il contient la version précédente de `informations_demande(uuid)`, **même signature**. Laisser `vehicules.livraison_apres_stockage` en place. | **Aucune** : `94` ne touche qu'une fonction de lecture et ajoute une colonne vide. |
| `93` | `update storage.buckets set file_size_limit = 52428800 where id = 'candidatures-videos';` | Les vidéos déjà déposées au-delà de la limite **restent lisibles**. |
| `92` | `drop function if exists public.creer_demande_avec_vehicules(jsonb, jsonb);` — **uniquement** si l'ancienne `index.html` est remise en ligne **en même temps**, sans quoi plus aucune demande ne peut être déposée. | **Aucune.** |

**Règle générale à retenir** : ces migrations *ajoutent*. Revenir en arrière
sur une migration additive fait, au mieux, disparaître une fonctionnalité — et
au pire, des données. Dans le doute, **remettez seulement l'ancien site en
ligne (§ 9.1) et laissez la base telle quelle.**

### 9.3 Revenir en arrière sur la fonction serveur

```bash
git checkout <empreinte du commit précédent> -- supabase/functions/candidature-video/index.ts
supabase functions deploy candidature-video
```

L'ancienne version reste compatible avec la nouvelle `index.html`, à une
réserve près : sans l'action `prolonger`, un envoi vidéo de plus de 30 minutes
échouera à la fin. Les envois courts ne sont pas affectés.

### 9.4 Restauration complète de la base — **dernier recours**

Supabase → **Database → Backups** → restaurer la sauvegarde de l'étape 0 du
§ 6.

⚠️ **Cette opération efface tout ce qui a été créé depuis la sauvegarde** :
demandes clients, candidatures, missions, photos. Ne l'utilisez que si une
migration a réellement corrompu des données — ce qu'aucune de celles de ce lot
ne fait. **Prévenez avant : le site doit être coupé pendant la restauration.**

### 9.5 Annuler la fusion de la Pull Request

Si le code doit être retiré de la branche principale :

```bash
git revert -m 1 <empreinte du commit de fusion>
git push
```

Cela crée un nouveau commit qui défait les changements, **sans réécrire
l'historique**. Le déploiement Vercel qui suit remet l'ancien site en ligne.
La base n'est pas touchée : appliquez ensuite le § 9.2 si nécessaire.

---

## 10. Ce qui reste hors de ce lot

Pour être complet, et pour qu'aucune de ces limites ne soit découverte en
production :

- **La lecture visuelle des devis PDF** n'est pas automatisable ici (§ 5.2).
- **MP4 et MOV** ne sont vérifiés qu'au niveau de l'acceptation, pas du décodage
  (§ 5.3). Recette manuelle décrite dans `tests/RECETTE-VIDEO.md`.
- **La durée de conservation des vidéos de candidature** doit être décidée et
  inscrite dans la politique de confidentialité — c'est une décision, pas un
  développement.
- **Le rattachement des demandes historiques à un compte client** est
  volontairement laissé non exécuté : un rapprochement par e-mail pourrait
  exposer la demande d'un tiers en cas d'adresse réutilisée. La requête est
  fournie, en commentaire, dans `migrations/06_informations_manquantes.sql`.
