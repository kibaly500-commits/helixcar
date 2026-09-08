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
| 21 | `eb1c898` | doc | Dossier de recette et de mise en production du lot |

**Puis les correctifs de l'audit indépendant** (§ 4 bis) :

| # | Empreinte | Point d'audit | Message |
|---|---|---|---|
| 22 | `60f3c0c` | 1 + 2 | Audit 1 et 2 : la fonction video ne pouvait pas etre appelee du tout |
| 23 | `a9f83d1` | 3 | Audit 3 : la reprise apres rechargement etait une promesse intenable |
| 24 | `dc0068f` | 5 | Audit 5 : connaitre un identifiant ne donne plus aucun droit |
| 25 | `e92f821` | 6 | Audit 6 : un partenaire lisait les coordonnees des clients d'HelixCar |
| 26 | `d0671c3` | 7 | Audit 7 : un partenaire pouvait changer le prix et se payer lui-meme |
| 27 | `2f83459` | 8 | Audit 8 : la migration 95 detruisait ce qu'elle n'avait pas reconnu |
| 28 | `0af092b` | 4 + 9 + 10 | Audit 4, 9 et 10 : le Dashboard, ce qu'il envoie et ce qu'il affiche |
| 29 | `454b26f` | 11 | Audit 11 : une campagne de tests qui ne pouvait pas echouer |
| 30 | `45545e3` | — | Non-regression : elargir le perimetre, en le nommant |
| 31 | `68c820a` | doc | Dossier de recette : les onze correctifs de l'audit |

**Puis le second audit indépendant** (§ 4 ter) :

| # | Empreinte | Point | Message |
|---|---|---|---|
| 32 | `92af19f` | 1 | Audit 2-1 : plus aucune donnee de base dans un attribut JavaScript |
| 33 | `985980b` | 2 | Audit 2-2 : une photo justificative doit exister vraiment |
| 34 | `6ad8615` | 3 | Audit 2-3 : des tests de dates qui ne tenaient que sous UTC |
| 35 | `adcf27a` | 4 | Audit 2-4 : la CI tournait, et elle avait raison d'echouer |
| 36 | `2676e8f` | 5 | Audit 2-5 : ne plus annoncer un espace client ou la demande n'est pas |

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

**Résultat global : 1 556 contrôles, 1 556 PASS, 0 FAIL — en une commande.**

```
npm test
```

30 suites, exécutées le 8 septembre 2026 **après le dernier commit de code**,
depuis zéro, en 267 secondes. Aucun chiffre de ce document n'est estimé ou
reporté d'une exécution antérieure.

Les suites sensibles aux dates ont en outre été passées dans **deux
fuseaux** :

```
TZ=UTC           node tests/t_dates.js   →  19 PASS / 0 FAIL
TZ=Europe/Paris  node tests/t_dates.js   →  19 PASS / 0 FAIL
```

> Le lot livrait 1 276 contrôles. Le premier audit (§ 4 bis) en a ajouté
> 127, le second (§ 4 ter) 51, le troisième (§ 4 quater) 54, le quatrième
> (§ 4 quinquies) 48 : la séparation des deux secrets, éprouvée
> offensivement sur PostgreSQL, et le poste partagé par deux personnes,
> joué de bout en bout dans le navigateur.

### 4.1 Trois familles de preuves, volontairement séparées

1. **PostgreSQL 16 local et jetable** (`tests/t_rls.sh`) — les **vrais**
   fichiers de `migrations/` sont appliqués sans modification, puis le
   comportement est observé pour de bon : ce que voit l'ancien Dashboard, ce
   que voit la nouvelle version, ce que voit un partenaire bloqué, ce que voit
   un client. **Jamais de connexion à Supabase.**
2. **Navigateur réel** (Chromium, Playwright) — 27 suites qui pilotent
   `index.html` et `dashboard.html` comme un utilisateur : clics, saisies,
   changements d'étape, rechargements, coupures réseau.
3. **Code serveur exécuté** (`t_video_securite.mjs`) — le vrai code de la
   fonction `candidature-video` est exécuté contre un double Supabase, pour
   éprouver le jeton, le chemin imposé, l'usage unique et le cloisonnement.

### 4.2 Résultats réels, suite par suite

#### Les 30 suites, du plus au moins fourni

| Suite | PASS | FAIL | Ce qu'elle couvre |
|---|---|---|---|
| `t_rls` | **291** | 0 | **Politiques RLS appliquées pour de vrai** sur PostgreSQL 16 jetable — 18 sections, dont V bis, W bis, Z, Z bis, R et R bis, toutes offensives |
| `t_mdp_ui` | **88** | 0 | Longueur minimale et bouton œil sur les six champs |
| `t_mission_nettoyage` | **72** | 0 | **§ 14** — fiche, création de mission, cloisonnement par métier, photos et leur relecture signée |
| `t_video` | **70** | 0 | **§ 4** — exigence et durée selon les métiers, formats, taille, remplacement, envoi, erreurs réseau |
| `t_video_securite` | **68** | 0 | **Sécurité serveur** : vrai code de `candidature-video`, **preflight CORS réel**, configuration versionnée |
| `t_durcissement` | **59** | 0 | **Audits 1 et 2** : valeur réelle du header `Authorization`, injection au clic sur la page des candidatures, plus aucun handler en ligne, filtrage d'URL, photo orpheline, isolement réseau |
| `t_tus` | **59** | 0 | **§ 4** — envoi reprenable contre un vrai serveur TUS ; **section D : rechargement réel**, section D bis : la reprise qui existe |
| `t_pro` | **54** | 0 | Trouver un professionnel : catégories, compteurs, véhicules, récap, envoi |
| `t_decisions` | **53** | 0 | Décisions par activité, six transitions, historique, persistance, refus d’autorisation |
| `t_devis_commun` | **52** | 0 | **§ 9** — devis réellement disponible pour les 4 services, un seul moteur |
| `t_multivehicules` | **48** | 0 | **§ 15** — la même demande de la saisie au PDF et à la fiche admin |
| `t_infos` | **45** | 0 | **§ 10** — rubriques manquantes uniquement, transmission, validation, garde-fous |
| `t_rattachement` | **73** | 0 | **Audits 2, 3 et 4** — `signUp` avec et sans session ; le PARCOURS COMPLET : confirmation, session, réclamation, secret consommé ; puis les DEUX secrets séparés et le poste partagé par deux personnes |
| `t_nettoyage_dashboard` | **43** | 0 | **§ 14** — contournement de connexion, chiffres réellement lus, plus rien de fictif |
| `t_nonreg` | **41** | 0 | **Non-régression** : convoyage, stockage, compte seul, partenaire, textes, **périmètre de fichiers** |
| `t_devis` | **40** | 0 | Devis PDF des 3 services + non-régression du devis convoyage |
| `t_periode` | **40** | 0 | **§ 7** — un seul calendrier début/fin, plage colorée, bornes, heures |
| `t_metiers` | **37** | 0 | **§ 13** — métiers cumulables, badges retirables, nomenclature partagée |
| `t_blocage` | **35** | 0 | **§ 12** — état affiché = état enregistré, persistance après rechargement |
| `t_client` | **35** | 0 | Espace client : session réelle, nouvelle demande, profil prérempli, F5, coupure réseau |
| `t_charte` | **34** | 0 | **§ 11** — palette comparée sur les styles **réellement calculés**, fond blanc |
| `t_motdepasse` | **33** | 0 | Réinitialisation du mot de passe, de bout en bout |
| `t_pro_ui` | **32** | 0 | Formulaire professionnel : métiers, alignement, effacement confirmé, validations |
| `t_nettoyage` | **28** | 0 | Parcours Nettoyage complet, du service au récapitulatif |
| `t_video_admin` | **27** | 0 | Dashboard : états de la vidéo, lecture par URL signée, nettoyage à la fermeture |
| `t_enregistreur` | **26** | 0 | **§ 4** — véritable enregistreur dans la page (caméra, chronomètre, relecture) |
| `t_brouillon` | **20** | 0 | Effacer / OK par rubrique, brouillon restauré après F5 |
| `t_contact` | **20** | 0 | Contact sur place : moi-même / une autre personne |
| `t_dates` | **19** | 0 | Calendriers liés, bornes, horaires même jour et multi-jours |
| `t_etapes` | **14** | 0 | **§ 6** — le bouton Continuer ne se grise jamais |
| **TOTAL** | **1 556** | **0** | 28 suites navigateur, 1 suite serveur, 1 suite PostgreSQL |

`t_rls` applique les **vrais** fichiers de `migrations/00` → `99` sans les
modifier, sur un PostgreSQL 16 local jetable, puis observe le comportement
effectif. Ses 18 sections, dont les six ajoutées par les audits :

| Section | Ce qu'elle prouve |
|---|---|
| **A** | La phase préparatoire reste compatible avec l'**ancien** Dashboard |
| **B** | Effet réel du durcissement : lecture vide et écriture silencieuse pour un appelant anonyme |
| **C** · **D** · **E** | Partenaire non bloqué, partenaire bloqué (zéro mission, auto-déblocage impossible), déblocage administrateur |
| **G** · **H** | Espace client : cloisonnement, réponse du client, validation administrateur |
| **V** | **Chantier nº 3** — l'erreur 42501 reproduite, création partielle comprise, puis corrigée |
| **V bis** | **Audit nº 5** — client B visant la demande du client A, partenaire, anonyme, mauvais secret, colonnes administratives présentes et futures, rejeu prouvé |
| **W** | **Chantier nº 10** — informations réellement manquantes selon le scénario |
| **W bis** | **Audit nº 6** — qui a le droit de lire un rapport : propriétaire, administrateur, et personne d'autre |
| **X** | **Chantier nº 13** — métiers, activité `technicien`, décisions créées **en attente** |
| **Y** | **Chantier nº 14** — missions de nettoyage, photos, bucket privé |
| **Z** | **Audit 1 nº 7** — écritures **hostiles directes** sur les missions : prix, client, paiement, statut, attribution |
| **Z bis** | **Audit 2 nº 2** — de fausses photos ne justifient plus rien : fichier inexistant, mauvaise mission, mauvais bucket, `ajoutee_par` forcé |
| **R** | **Audit 3** — le rattachement après confirmation : reproduction du défaut, puis 26 contrôles offensifs sur la réclamation |
| **R bis** | **Audit 4** — le secret gardé n'ouvre RIEN d'autre : pas de rejeu de création, pas de numéro client, pas de véhicule greffé, et une seule signature |
| **F** | **Idempotence** : toute la chaîne rejouée — aucune erreur, aucune politique ni trigger en double |

### 4.3 Ce que la campagne a rattrapé

Cette exécution complète n'était pas une formalité : **elle a trouvé trois
défauts réels**, tous corrigés avant la remise — les commits `3b42afc` et
`61082c6`, puis `45545e3` quand le garde-fou de périmètre a vu arriver les
fichiers de l'audit. C'est la raison pour laquelle les chiffres ci-dessus proviennent
d'une campagne lancée **après** le dernier commit de code, et non d'un cumul
d'exécutions passées.

---

## 4 bis. Audit indépendant — onze défauts trouvés, onze corrigés

Un audit indépendant a relu ce lot **après** la campagne des 1 276 contrôles
et y a trouvé onze défauts que ces contrôles ne voyaient pas. Ils sont tous
corrigés, et chacun a désormais un test qui **échoue si le défaut revient**.

Le plus important à retenir : **quatre d'entre eux auraient empêché le lot de
fonctionner ou ouvert un accès non autorisé en production.** Les tests
existants ne les voyaient pas parce qu'ils vérifiaient l'intention du code,
pas son effet réel sur le réseau et en base.

| # | Défaut | Ce qu'il permettait ou empêchait | Preuve du défaut |
|---|---|---|---|
| 1 | La fonction `candidature-video` n'avait **aucune configuration versionnée** | Supabase exige un JWT par défaut : **toute candidature vidéo aurait été refusée avec un 401**, avant d'exécuter une ligne de code | `supabase/config.toml` créé ; `t_video_securite` 7.17 / 7.18 |
| 2 | Le CORS n'autorisait pas l'en-tête `apikey`, **que le navigateur envoie pourtant** | Le preflight échouait : **la requête réelle n'était jamais émise**. Côté candidat : « connexion interrompue », et rien du tout dans les journaux serveur | `t_video_securite` 7.6 → 7.16 — **5 FAIL** contre l'ancien code |
| 3 | La « reprise après rechargement » était **prouvée par un test qui réinjectait lui-même le secret** | La promesse ne tenait pas : après un F5, ni le fichier ni l'autorisation n'existent plus | `t_tus` section D, qui recharge **réellement** |
| 4 | `_compterLignes()` envoyait la **clé anonyme** en `Authorization` | Après le durcissement RLS, les compteurs auraient affiché **zéro en HTTP 200** — sans la moindre erreur visible | `t_durcissement` A3 / A4 — **la clé anonyme partait sur 4 requêtes** |
| 5 | La migration `92` acceptait **toute colonne sauf une liste d'exclusion**, et l'UUID seul valait preuve de rejeu | Connaître l'identifiant d'une demande suffisait à **y greffer ses véhicules** et à **lire le numéro client d'autrui** | `t_rls.sh` V13 → V28 — **15 FAIL** contre l'ancienne migration |
| 6 | `informations_demande()` n'avait **aucun contrôle d'autorisation** | Un partenaire lit le `client_id` sur sa mission : il obtenait **8 rubriques** de la demande — contacts, adresses, dates | `t_rls.sh` W39 → W45 — **3 FAIL** contre l'ancienne migration |
| 7 | La policy de mise à jour des missions ne regardait **jamais quelle colonne** était modifiée | Par `PATCH` direct sur l'API, un partenaire pouvait **changer le prix**, se déclarer **« terminée »**, cocher la **validation de paiement** | `t_rls.sh` Z1 / Z2 reproduisent, Z4 → Z26b prouvent la fermeture |
| 8 | La migration `95` supprimait **toute contrainte contenant le mot « activite »** | Une contrainte sans rapport était détruite, et **jamais remise** | `t_rls.sh` X20 / X21 — **2 FAIL** contre l'ancienne migration |
| 9 | Une photo envoyée restait **orpheline** si l'écriture en base échouait ensuite | Un fichier que personne ne référence, que personne ne supprime, et qui compte dans le quota | `t_durcissement` E4 → E9 |
| 10 | Des valeurs de base finissaient dans du `innerHTML` **sans échappement** | **Injection JavaScript réelle** : nom de client, plaque, URL, référence dans un `onclick` | `t_durcissement` B1 — la charge s'est exécutée **5 fois** contre l'ancien code |
| 11 | Le seul contrôle sur la Pull Request était Vercel, et le lanceur de tests **ne pouvait pas échouer** | `node "$f" || echo "ÉCHEC"` avale le code de retour : une suite en échec passait inaperçue | `.github/workflows/tests.yml` + `tests/lancer.js` |

### 4 bis.1 Ce qui a changé dans la façon de tester

Trois principes en sortent, appliqués à tous les nouveaux contrôles :

1. **Mesurer ce qui part sur le réseau, pas ce que le code a l'air de faire.**
   `t_durcissement` enregistre la **valeur** de l'en-tête `Authorization` de
   chaque requête. Un double qui ignore les en-têtes ne prouve rien.
2. **Attaquer pour de vrai.** Les charges de `t_durcissement` ne
   « ressemblent » pas à une attaque : elles s'exécutent si l'échappement
   manque, et un compteur le constate.
3. **Prouver que le test voit le défaut.** Chaque correction a été rejouée
   contre le code d'avant. Les chiffres de la colonne « Preuve » ci-dessus
   sont ceux de ces exécutions.

---

## 4 ter. Second audit indépendant — cinq points, cinq corrigés

Un second audit a relu la branche au commit `68c820a`. Cinq points, dont
**deux bloquants**. Tous corrigés, chacun avec un test qui échoue si le
défaut revient.

| # | Défaut | Ce qu'il permettait | Preuve du défaut |
|---|---|---|---|
| 1 | **Injection JavaScript encore exploitable** dans `loadCandidatures()` | Le nom d'un candidat passait par `escapeHtml()` — qui transforme `'` en `&#39;` — puis par un `.replace(/'/g, …)` qui ne trouvait donc plus rien à échapper. Le navigateur redécodait avant le parseur JavaScript : **la charge s'exécutait au clic sur « Valider »** | `t_durcissement` B12 — sur `68c820a`, `window.__xss = 99` |
| 2 | **De fausses photos justifiaient une prestation** | `mission_photos_completes()` ne comptait que des LIGNES. Un partenaire écrivait deux chemins vers des fichiers inexistants, puis passait sa mission à « fini ». `ajoutee_par` était de surcroît choisi par l'appelant | `t_rls.sh` Z20/Z21 (reproduction) — **9 FAIL** sans la migration `98` |
| 3 | **Tests de dates non portables** | `toISOString()` sur des dates civiles : en France le 10 décembre devient le 9. Les tests passaient sous `TZ=UTC` et tombaient sous `Europe/Paris` — le fuseau des utilisateurs | `TZ=Europe/Paris node tests/t_dates.js` → 2 FAIL avant correction |
| 4 | **La CI échouait** — et pour une raison grave | Sur un runner GitHub, le CDN répond : la **vraie** bibliothèque `supabase-js` écrasait le double des tests. 44 contrôles tombaient, et surtout les tests **auraient pu atteindre la base réelle** | Exécution nº 2 du workflow sur `68c820a` : 813 PASS / 44 FAIL |
| 5 | **Un espace client annoncé mais vide** | `signUp()` renvoie un utilisateur sans session dès que la confirmation d'e-mail est active. L'appel restait anonyme, la demande partait sans propriétaire, et l'écran annonçait un compte créé | `t_rattachement` — **10 FAIL** sur `68c820a` |

### 4 ter.1 Ce que le point nº 1 a changé dans l'approche

Corriger l'échappement une fois de plus n'aurait rien réglé : le défaut
venait de l'existence même d'un contexte JavaScript dans un attribut.
**Les 44 handlers dynamiques du Dashboard ont donc été supprimés.** Les
arguments voyagent dans des attributs `data-*` — du texte, rien d'autre —
et un écouteur délégué unique les relit au clic, en résolvant le nom de
l'action dans un registre explicite. Il n'y a plus d'ordre d'échappement
à ne pas se tromper, parce qu'il n'y a plus d'échappement à faire.

### 4 ter.2 Ce que le point nº 4 a changé dans la façon de tester

Les suites ne dépendent plus du hasard du réseau. `tests/env.js` coupe
désormais **toute** requête sortante, sur toutes les machines. Seuls
subsistent les fichiers locaux et les serveurs de test lancés sur la
machine elle-même. C'est ce qui garantit — et non plus seulement ce qui
espère — qu'aucun test ne peut atteindre Supabase.

### 4 ter.3 État réel de l'intégration continue

Le second audit signalait « aucune exécution du workflow ». **Ce n'était
pas le cas** : le workflow était bien enregistré et actif, et il s'était
exécuté deux fois sur `68c820a` — une fois sur la poussée, une fois sur la
Pull Request.

| Tâche | Sur `68c820a` |
|---|---|
| Politiques RLS sur PostgreSQL 16 | ✅ **verte** |
| Suites navigateur et sécurité serveur | ❌ **rouge** — 813 PASS / 44 FAIL |

Ce que l'onglet *Checks* montrait donc, c'était un workflow **rouge**, pas
un workflow absent. La cause est le point nº 4 ci-dessus.

**Après correction, sur le commit `c4af4e6`** — exécution nº 4, observée
et terminée, non prédite :

| Tâche | Résultat |
|---|---|
| Politiques RLS sur PostgreSQL 16 | ✅ **success** — 16:03:26 |
| Suites navigateur et sécurité serveur | ✅ **success** — **1 213 PASS / 0 FAIL en 142 s** |

L'écart entre 1 213 (CI) et 1 454 (local) est attendu et connu : la tâche
navigateur tourne avec `--sans-sql`, sans les 241 contrôles de `t_rls`,
qui sont l'objet de la seconde tâche. 1 213 + 241 = 1 454.

---

## 4 quater. Troisième audit — une promesse non tenue

Un troisième audit a relu la branche au commit `f73c413`. Il confirme les
correctifs XSS, la migration `98`, l'isolement réseau et la CI. Il trouve
**un défaut fonctionnel**, et il a raison.

L'écran affirmait, après une inscription avec confirmation d'e-mail
requise :

> « elle apparaîtra dans votre espace une fois votre adresse confirmée »

**Ce comportement n'existait pas.** Aucune fonction, aucun trigger, aucun
RPC ne rattachait la demande après confirmation. Et mon propre test ne le
voyait pas : il lisait le message affiché, puis s'arrêtait — il ne
simulait jamais la confirmation, ni l'ouverture de session, ni la
visibilité réelle de la demande.

C'est exactement le défaut que les deux audits précédents m'avaient fait
corriger ailleurs — une annonce que le code ne tient pas — cette fois de
ma main.

### Reproduit d'abord, sur les vraies migrations

`tests/t_rls.sh` section **R**, contrôles R1 à R4 :

| Étape | Constat |
|---|---|
| `signUp()` sans session | la demande est écrite avec `auth_user_id = NULL` |
| le client confirme son adresse | — |
| il ouvre une session | `v_mes_demandes` renvoie **zéro ligne** |
| | `auth_user_id` vaut toujours **NULL** |

### Pourquoi pas un rattachement par e-mail

C'est la solution évidente, et c'est celle que
`06_informations_manquantes.sql` refuse déjà. Une adresse se ressaisit, se
partage en famille ou en entreprise, se trompe. Rattacher sur ce seul
critère donnerait à quelqu'un les demandes d'un autre.

**L'adresse reste une condition, jamais une preuve.**

### Ce qu'exige la migration `99`

Six conditions, toutes nécessaires, aucune suffisante :

| # | Condition |
|---|---|
| 1 | une session authentifiée |
| 2 | une adresse **réellement** confirmée (`auth.users.email_confirmed_at`) |
| 3 | cette adresse **égale** celle portée par la demande |
| 4 | l'**identifiant exact** de la demande |
| 5 | un **secret aléatoire**, dont seule l'empreinte SHA-256 est en base |
| 6 | ce secret **encore valide** — il expire au bout de 30 jours |

Après réussite, le secret est **consommé** : l'empreinte est effacée. Un
rejeu par le même compte est idempotent ; par un tiers, refusé. La
fonction n'est **pas** accordée à `anon`.

### Un secret persisté ici, refusé pour la vidéo — pourquoi ce n'est pas contradictoire

| | Envoi vidéo (§ 4 bis nº 3) | Réclamation d'une demande |
|---|---|---|
| Ce que le secret permet seul | **confirmer** la candidature | **rien** — il faut en plus une session et une adresse confirmée identique |
| Ce que sa persistance apporte | **rien** : le fichier a disparu du navigateur | la seule façon de tenir la promesse |
| Durée | indéfinie | 30 jours, puis effacé |
| Après usage | réutilisable | **consommé** |

Le persister pour la vidéo aurait ajouté un risque pour un gain nul. Ici,
il est inutile sans le compte, et il rend vraie une phrase qui ne l'était
pas.

### Ce que la CI a trouvé ensuite, et que ma machine ne voyait pas

La poussée suivante a fait tomber la tâche navigateur : `t_tus` **G7** et
**G13**, avec `[0/15728640]` — le serveur n'avait reçu **aucun octet**.
Ce n'était pas une intermittence, et je ne l'ai pas traité comme telle.

La progression affichée mélange volontairement deux choses : les octets
déjà **acquittés** par le serveur et ceux **encore en vol** dans la
requête courante. C'est ce que le candidat doit voir. Sur 15 Mo découpés
en morceaux de 6 Mo, le premier morceau fait donc monter l'affichage
jusqu'à **40 %** avant que le serveur n'ait rien enregistré. Le test
annulait à 30 % : sur une machine assez chargée pour qu'un événement de
progression tombe en plein vol, il coupait cette première requête, et
« l'envoi s'est arrêté avant la fin » devenait indémontrable.

**Reproduit d'abord**, sans deviner : en bridant la lecture du corps par
le serveur de test — ce que fait un runner chargé — l'ancien seuil donne
exactement l'échec de la CI, `[0/15728640]`.

Le test annule désormais sur un **fait**, pas sur un affichage : la fin
d'une requête `PATCH`. À cet instant le serveur a acquitté le morceau et
aucune requête n'est en vol, donc rien ne peut être tronqué, quelle que
soit la vitesse de la machine. Un simple seuil plus haut ne suffisait
pas : à 50 % c'est le **deuxième** morceau qui était coupé en vol, et
**G12** tombait à son tour — vérifié, pas supposé.

| Sous le même bridage | Résultat |
|---|---|
| ancien déclencheur (30 %) | **57 PASS / 2 FAIL** — `[0/15728640]`, l'échec de la CI |
| seuil relevé à 50 % | **58 PASS / 1 FAIL** — G12 : `17 248 748` octets pour 15 728 640 |
| annulation sur la fin du `PATCH` | **59 PASS / 0 FAIL**, quatre fois de suite |

### L'intégration continue sur le commit de tête

Exécutions nº 11 et nº 12 sur `0623364`, **observées et terminées**, non
prédites :

| Tâche | Résultat |
|---|---|
| Politiques RLS sur PostgreSQL 16 | ✅ **success** |
| Suites navigateur et sécurité serveur | ✅ **success** — **1 236 PASS / 0 FAIL en 160 s** |

1 236 (CI, avec `--sans-sql`) + 272 (`t_rls`, seconde tâche) = **1 508**,
le chiffre mesuré localement.

---

## 4 quinquies. Quatrième audit — deux défauts dans le mécanisme lui-même

Le mécanisme de réclamation corrigeait bien le défaut de fond. Un
quatrième audit y a trouvé **deux défauts propres**, et il a raison sur
les deux.

### Défaut nº 1 — le secret gardé donnait un droit à lui seul

Ce document affirmait : « le secret ne donne **aucun** droit à lui
seul ». C'était **faux**. Le navigateur conservait trente jours
exactement la valeur envoyée comme `p_cle_creation` — c'est-à-dire la
**preuve de rejeu** de `creer_demande_avec_vehicules()`.

Reproduit sur PostgreSQL 16, contre les migrations de `bddd810` :

```
-- ce que le navigateur gardait : repeat('S',48)
   empreinte de création posée en base    : 1
   empreinte de réclamation posée en base : 1   ← la MÊME

-- rejeu ANONYME, sans aucune session, avec ce seul secret :
{"id": "dddddddd-…-000000000001", "vehicules": 1,
 "numero_client": "TEST-QA-VOL1", "deja_existante": true}
   véhicules greffés sur la demande de la victime : 1
   numéro client livré                            : TEST-QA-VOL1
```

Et `reclamer_demande()` n'effaçait que `reclamation_cle_hash` : l'usage
de création survivait au rattachement. « Le secret est consommé » était
donc incomplet.

**Correction — deux secrets, séparés par construction.**

| | Secret de création | Secret de réclamation |
|---|---|---|
| Tiré par | le navigateur | le navigateur, **indépendamment** |
| Persisté | **jamais** — il meurt avec la page | oui, 30 jours |
| Paramètre | `p_cle_creation` | `p_cle_reclamation` (nouveau) |
| Ce qu'il ouvre | le rejeu de la création | `reclamer_demande()` et rien d'autre |
| Empreinte | `empreinte_secret('creation', …)` | `empreinte_secret('reclamation', …)` |

La séparation ne repose pas sur le hasard des tirages. Chaque empreinte
est **préfixée par son usage** : même présentée à l'autre vérification,
la même chaîne ne produit pas la même valeur. C'est structurel.

Au rattachement, `creation_cle_hash` est effacée elle aussi : la demande
a désormais un propriétaire, qui prouve son droit par sa session.

Enfin, l'ajout d'un paramètre créerait une **seconde signature** et
PostgREST refuserait de choisir. La migration `92` retire donc
explicitement la signature à trois arguments avant de créer celle à
quatre — et deux contrôles (`R45`, `F8`) vérifient qu'il n'en existe
jamais qu'une, y compris après rejeu des migrations.

*La même attaque, contre le correctif :*

```
   correspond-il à l'empreinte de création ?    0
   correspond-il à l'empreinte de réclamation ? 1

{"id": "e8da3295-… (identifiant NEUF)", "numero_client": null,
 "deja_existante": false}
   véhicules greffés sur la demande de la victime : 0
   la demande visée a-t-elle bougé ?  numéro = TEST-QA-VOL2
```

### Défaut nº 2 — une session pouvait détruire la réclamation d'une autre

`_hcReclamerDemandesEnAttente()` présentait **toutes** les réclamations
du navigateur à la session ouverte. Le serveur refusait celles d'autrui
— adresse différente — et le navigateur prenait ce refus pour définitif :
il effaçait le secret.

Sur un poste partagé, une famille, un ordinateur d'entreprise :

| Étape | Ce qui se passait |
|---|---|
| A et B déposent chacun une demande, sans confirmer | deux réclamations en attente |
| A confirme et ouvre sa session | le navigateur présente **aussi** celle de B |
| le serveur refuse B (adresse différente) | `RECLAMATION_REFUSEE` |
| le navigateur efface le secret de B | **la demande de B devient irrécupérable** |
| B confirme ensuite son adresse | il n'y a plus rien à réclamer |

L'adresse était pourtant déjà enregistrée dans chaque entrée locale ;
elle n'était simplement jamais lue.

**Correction.** Avant tout appel, le navigateur demande au serveur
d'authentification l'adresse de la session (`auth.getUser()`), la
normalise comme le fait PostgreSQL (`lower(btrim(…))`), et ne présente
que les réclamations portant cette adresse. Les autres ne sont **ni
tentées, ni touchées**. Une entrée sans adresse n'est même pas
enregistrée : elle ne pourrait jamais aboutir.

### Les preuves, mesurées avant et après

| Preuve | Contre `bddd810` | Après correctif |
|---|---|---|
| `tests/t_rls.sh` (sections R et R bis) | **24 FAIL** | 291 PASS / 0 FAIL |
| `tests/t_rattachement.js` | **28 FAIL** | 73 PASS / 0 FAIL |

Parmi les échecs contre `bddd810`, les quatre qui disent tout :

| Contrôle | Ce qu'il a obtenu sur `bddd810` |
|---|---|
| `C14 bis` — le secret de création n'est écrit nulle part | `{"local": true, …}` |
| `E1` — la session A ne présente que ses réclamations | elle présentait A **et B** |
| `E4` — la réclamation de B reste intacte | elle avait **disparu** |
| `R34` — le secret gardé ne rejoue pas la création | il la **rejouait** |

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

### Étape 2 — Migrations `93` à `99` (17 minutes)

**Un fichier à la fois, dans cet ordre, en vérifiant chaque fois.**

| Ordre | Fichier | Ce que ça fait | Contrôle à passer juste après |
|---|---|---|---|
| 2.1 | `93_bucket_video_300mo.sql` | porte la limite du bucket vidéo à 300 Mo | `select file_size_limit from storage.buckets where id = 'candidatures-videos';` → **314572800** |
| 2.2 | `94_informations_selon_scenario.sql` | ne réclame au client que ce qui manque **vraiment**, selon son scénario | `select count(*) from pg_proc where proname = 'hc_texte';` → **1** |
| 2.3 | `95_metiers_partenaires.sql` | les candidats peuvent déclarer plusieurs métiers ; l'activité « technicien » devient possible | `select count(*) from information_schema.columns where table_name='convoyeurs' and column_name='metiers';` → **1** |
| 2.4 | `96_missions_nettoyage.sql` | les missions de nettoyage et leurs photos avant/après | `select count(*) from storage.buckets where id = 'missions-photos';` → **1** |
| 2.5 | `97_missions_verrou_serveur.sql` | **correctif de sécurité** : ferme ce qu'un partenaire peut changer sur une mission | `select count(*) from pg_trigger where tgrelid='public.missions'::regclass and not tgisinternal;` → **au moins 2** |
| 2.6 | `98_photos_justificatives_reelles.sql` | **correctif de sécurité** : une photo justificative doit exister vraiment | `select count(*) from pg_trigger where tgrelid='public.mission_photos'::regclass and not tgisinternal;` → **au moins 1** |
| 2.7 | `99_reclamation_demande.sql` | **correctif fonctionnel** : le client rattache sa demande après avoir confirmé son adresse | `select count(*) from pg_proc where proname='reclamer_demande';` → **1** |

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
# DEPUIS LA RACINE DU DÉPÔT — c'est là que se trouve supabase/config.toml.
supabase functions deploy candidature-video
```

⚠️ **Lancez la commande depuis la racine du dépôt.** C'est là que se trouve
`supabase/config.toml`, qui porte un réglage sans lequel **plus aucune
candidature vidéo ne fonctionne** :

```toml
[functions.candidature-video]
verify_jwt = false
```

Une candidature est déposée **avant** toute authentification — le candidat
n'a pas encore de compte. Le navigateur n'a donc aucun jeton utilisateur à
présenter, et Supabase refuserait la requête par défaut, avant même
d'exécuter la fonction. Ce réglage ne diminue rien : c'est la fonction
elle-même qui autorise, et plus strictement que le réglage général
(jeton à usage unique, chemin imposé par le serveur, bucket privé, origine
contrôlée).

*Contrôle supplémentaire* : Supabase → **Edge Functions →
candidature-video** → la vérification JWT doit apparaître **désactivée**.
Si l'interface affiche l'inverse, le déploiement n'a pas lu le fichier :
recommencez depuis la racine du dépôt.

**À faire avant le déploiement Vercel** : sans cette version, un envoi long
échouerait au bout de 30 minutes, et le dépôt de vidéo serait bloqué par le
navigateur (l'en-tête `apikey` n'était pas autorisé par l'ancienne
configuration CORS).

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
# Une seule fois, la première fois :
npm ci
npx playwright install --with-deps chromium

# TOUTE la campagne, en une commande :
npm test
```

`npm test` appelle `node tests/lancer.js`, qui exécute chaque suite dans son
propre processus, **additionne les échecs réellement rapportés** et sort avec
un code non nul dès qu'une seule chose ne va pas.

> **Ce que la commande précédente ne faisait pas.** Elle était écrite
> `for f in tests/t_*.js; do node "$f" || echo "ÉCHEC $f"; done` : le
> `|| echo` avale le code de retour, et le statut final est celui du dernier
> `echo`. **Cette boucle ne pouvait pas échouer.** Une suite en échec passait
> inaperçue — y compris dans une intégration continue, qui aurait affiché un
> vert rassurant.

Pour ne relancer qu'une partie :

```bash
node tests/lancer.js --sans-sql              # sans PostgreSQL
node tests/lancer.js --seulement video       # les suites dont le nom contient « video »
```

C'est exactement la commande qui a produit les chiffres du § 4.2.

**Attendu : `0 FAIL` partout, et un code de sortie nul.** Si une suite
échoue, **n'appliquez aucune migration** et signalez-le.

Les mêmes tests tournent automatiquement sur GitHub à chaque poussée et sur
chaque Pull Request (`.github/workflows/tests.yml`).

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
| `99` | `drop function if exists public.reclamer_demande(uuid, text);` et les deux fonctions listées en fin de fichier. Laisser les colonnes `reclamation_*`. | **Aucune** — mais la phrase promettant que la demande apparaîtra après confirmation **redevient fausse**. La retirer alors d'`index.html`. Les demandes déjà rattachées le restent : leurs empreintes ont été effacées au rattachement. |
| `98` | `drop trigger if exists trg_verrou_photo_mission on public.mission_photos;`, puis réappliquer `97`. | **Aucune** — mais revenir dessus permet de nouveau de **justifier une prestation avec des photos qui n'existent pas**. |
| `97` | `drop trigger if exists trg_verrou_maj_mission on public.missions;` et `drop trigger if exists trg_verrou_creation_mission on public.missions;` (les fonctions à retirer sont listées en fin de fichier). | **Aucune** — mais revenir dessus **rouvre le défaut de sécurité** : un partenaire pourrait de nouveau changer le prix d'une mission ou la valider lui-même. |
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
