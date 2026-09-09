# Stabilisation HelixCar après la Pull Request nº 2

Ce dossier accompagne la branche `claude/helixcar-etape2-blocage-ecn7qe`.
Il dit ce qui était cassé, **pourquoi**, ce qui a été corrigé, ce qui a
été préservé, et ce qui reste à vérifier à la main.

---

## 1. Point de départ

| | |
|---|---|
| Branche de départ | `main`, commit **`8b86148`** (fusion de la PR nº 2) |
| Branche de travail | `claude/helixcar-etape2-blocage-ecn7qe` |
| Migrations déjà appliquées en production | `00` → `06`, `90`, `91`, **`92` → `99`** |
| Migrations nouvelles, **non exécutées** | `100`, `101`, `102` |

**Rien n'a été fusionné, déployé, ni appliqué sur Supabase. Aucun e-mail
réel n'a été envoyé. Aucune donnée réelle n'a été touchée.** Les jeux
d'essai sont préfixés `TEST-QA-CLAUDE-POSTPR2` et utilisent des adresses
en `.test` ou `.invalid`.

### L'ancien index, vérifié avant usage

| | Attendu | Constaté |
|---|---|---|
| Taille | 792 811 octets | 792 811 |
| Lignes | 17 189 | 17 189 |
| SHA-256 | `3a3f7aa6…ceb0f` | `3a3f7aa64126156e03ed9f003811a27ac38f6da7ccc513a80071ac2bf77ceb0f` |

Il a servi de **référence en lecture seule**. Il n'a jamais été modifié,
ni recopié, ni substitué au fichier courant.

---

## 2. Manifeste des nouveautés — la liste de non-régression

Comparaison systématique de l'ancien index (17 189 lignes, 308 fonctions)
et de l'index du `main` courant (21 017 lignes, 459 fonctions).

**154 fonctions existent dans l'index actuel et pas dans l'ancien.** Ce
sont les nouveautés à protéger. Trois fonctions de l'ancien index ont
disparu avant ce chantier — `_hcEffacerStockage`, `_hcPeriodeStockageBrute`,
`enregistrerVehicules` — remplacées par `_hcEffacerPeriode`,
`_hcPeriodeBrute` et l'écriture atomique de la migration 92. Ce sont des
remplacements assumés de la PR nº 2, pas des régressions.

### Ce qui est préservé, et vérifié

| Élément | Ancien index | Index actuel | Décision |
|---|---|---|---|
| Parcours **Trouver un professionnel** | présent mais non finalisé | complet (`_pro*`, 40 fonctions) | **préservé, intouché** |
| Parcours **Nettoyage professionnel** | présent mais non finalisé | complet | **préservé**, deux modifications explicitement demandées (§ 5) |
| Métier **Soutien administratif** | absent | présent | **préservé** |
| Multi-véhicules et indépendance des fiches | présent | présent | **préservé**, et **renforcé** (§ 4.3) |
| Les quatre rubriques par véhicule | présentes, la 4ᵉ conditionnelle | présentes, la 4ᵉ **inconditionnelle** | **corrigé** (§ 4.3) |
| Boutons Effacer / OK / Valider | présents | présents | **préservés** |
| Calendriers de périodes et règles de dates | présents | présents | **préservés**, étendus au Nettoyage |
| Limite vidéo 300 Mo | absente | présente | **préservée** |
| Enregistreur vidéo réel | absent | présent | **préservé** |
| Envoi vidéo + Edge Function `candidature-video` | absents | présents | **préservés** |
| Devis commun aux 4 services, nouveaux modèles | absents | présents | **préservés** |
| Dashboards admin / client / partenaire | présents | présents | **préservés** |
| Informations nécessaires à la mission | absentes | présentes | **préservées**, corrigées (§ 4.4) |
| Rattachement sécurisé après confirmation d'e-mail | absent | présent | **préservé** |
| Migrations et protections `92` → `99` | absentes | présentes | **intouchées** |
| Suppression des handlers JS dynamiques | absente | présente | **préservée** |
| Protections photos fictives / missions hostiles | absentes | présentes | **préservées** |
| CI et isolement réseau des tests | absents | présents | **préservés** |
| Charte Dashboard fond blanc | absente | présente | **préservée** |
| Délai commercial « sous 1 heure » | « moins de 2h » | mixte | **harmonisé** (§ 5.3) |

### Preuve qu'aucune nouveauté n'a disparu

Inventaire des fonctions, avant et après le chantier :

```
fonctions du manifeste initial encore présentes : 455 / 459
fonctions retirées                              :   4
fonctions ajoutées par la stabilisation         :   7
```

> **Le comptage ne prouve rien à lui seul** — une fonction peut exister
> et ne plus rien faire. C'est pourquoi le § 12.6 en fait un
> **manifeste fonctionnel** : chaque nouveauté y est vérifiée par un
> comportement réellement observé (section **N** de
> `tests/t_stabilisation.js`), et le § 12.7 vérifie qu'aucun libellé
> historique n'a disparu sans raison nommée (section **O**).

Inventaire **re-mesuré** au terme de la revue, règle d'extraction
explicite (`^function nom(` en début de ligne, doublons fusionnés) :

```
index.html      : 446 fonctions dans le main fusionné
                  442 encore présentes · 4 retirées · 6 ajoutées
dashboard.html  : 1 retirée · 4 ajoutées
```

La fonction retirée du Dashboard est `_referenceMissionNettoyage()` :
**code mort** qui portait la même course que le défaut nº 2 du § 12.0.
Supprimée plutôt que laissée en embuscade.

Les **quatre** fonctions retirées de `index.html` sont exactement celles
dont la suppression était demandée :

| Fonction retirée | Pourquoi |
|---|---|
| `onModeTransport` | le contrôle global « Standard / Sur plateau », explicitement à supprimer |
| `_nettTypeDispo`, `_nettHeure`, `nettOnDispoChange` | la question « Quelle est votre disponibilité ? », explicitement à supprimer |

Aucune suppression par supposition. Aucun remplacement intégral de
`index.html`, aucun copier-coller depuis l'ancien fichier, aucun retour
arrière global.

---

## 3. Ce qui était cassé, et pourquoi

### 3.1 Aucune candidature de technicien ne passait — `23514`

```
code 23514
new row for relation "convoyeurs" violates check constraint
"convoyeurs_activites_valides"
```

**Cause.** La migration `95` a introduit l'activité `technicien` et trois
métiers qui la portent. Elle a bien élargi la contrainte d'énumération
de `convoyeur_decisions.activite`. Mais `public.convoyeurs` porte **sa
propre** contrainte, créée bien avant ce dépôt, présente dans **aucun**
fichier de `migrations/`. Personne ne l'a élargie — et le socle de tests
ne la reproduisait pas, ce qui explique qu'aucun test ne l'ait vue.

**Fichiers.** `tests/pg/00_socle_supabase.sql` (la contrainte est
désormais déclarée telle qu'elle est en production),
`migrations/100_activites_partenaire.sql` (nouvelle).

### 3.2 Une erreur de candidature s'affichait dans la création de compte

```
Erreur 400 [convoyeurs]
code 23514 …
```
… au moment de créer un simple compte particulier, sans aucune
candidature ni demande.

**Cause, prouvée par lecture.** Le parcours client **n'écrit pas** dans
`convoyeurs` : il n'existe qu'**une seule** écriture vers cette table
dans tout le fichier (`submitConvoyeurForm`, ligne 17885 du `main`).
C'est `supabaseInsert()` qui peignait la réponse brute de PostgREST dans
`#supabase-debug` :

```js
dbg.innerHTML = '<b>Erreur ' + r.status + ' [' + table + ']:</b> ' + txt;
```

Or `#supabase-debug` vit **dans la fenêtre « Devenir client »**, juste
au-dessus du bouton « Créer mon compte ». Une candidature partenaire en
échec y laissait son erreur, et personne ne l'effaçait.

Trois défauts en un : un élément d'erreur partagé entre deux fenêtres,
du SQL brut montré à l'utilisateur, et aucun effacement entre deux
tentatives.

**Fichiers.** `index.html` — `supabaseInsert`, `openModal`,
`submitConvoyeurForm`, nouvelle zone `#conv-erreur-envoi`.

### 3.3 « Votre compte a été créé » pour un compte inexistant

**Cause.** L'issue du `signUp` n'était jamais regardée. Le `catch` se
contentait d'un `console.warn`, `_compteCree` restait `false`, et
l'écran écrivait quand même, **sans condition** :

```js
html += '<div class="hc-succes-txt">Votre compte HelixCar est maintenant créé.</div>';
```

Adresse déjà prise, mot de passe refusé, coupure réseau : succès
affiché, compte absent, connexion impossible ensuite.

**Fichiers.** `index.html` — `_submitClientFormInterne`.

### 3.4 Le mode de transport disparaissait, ou se dédoublait

**Cause.** Deux mécanismes concurrents pour la même question.

1. Un bloc **par véhicule**, généré sous condition :
   `if ((pcIndiv || livIndiv) && livActive === true)`.
   `livActive` vient de la fiche mémorisée : il vaut `null` tant que le
   client n'a pas répondu à « Livraison après stockage pour ce
   véhicule ? ». Un véhicule jamais ouvert n'avait donc **aucun** mode
   de transport.
2. Un contrôle **global** au dossier : des boutons radio, un `<select>`
   masqué « Standard / Sur plateau », une case à cocher masquée. Il
   s'affichait sous les fiches quand le bloc du véhicule manquait, et
   c'est **lui** qui partait en base pour tout le dossier.

Ce défaut existe **à l'identique dans l'ancien index** (ligne 15035) :
ce n'est pas une régression de la PR nº 2, c'est un défaut ancien qui se
voit davantage depuis que les fiches véhicules sont systématiques.

**Mesure contre le `main`**, scénario Stockage / sortie HelixCar /
trajets individuels / 3 véhicules / réponse donnée pour le premier
seulement :

```
véhicules : [{titres:1}, {titres:0}, {titres:0}]
modes lus : ["standard", "", ""]
```

Les véhicules 2 et 3 n'ont pas de bloc et partent en base avec un mode
**vide** — exactement ce que montrait le Dashboard du dossier de test :
V1 et V2 renseignés, V3 sans rien.

**Fichiers.** `index.html` — `rendreFichesVehicules`, `_majBlocsTransport`,
`clientQuoteCalc`, le récapitulatif, le payload, et le HTML du bloc global.

### 3.5 « COALESCE types date and text cannot be matched »

**Cause.** `informations_demande()` rassemblait la date portée par le
**véhicule** et, à défaut, celle portée par la **demande** :

```sql
coalesce(v.date_prise_en_charge,
         case when commun then d.date_prise_en_charge end) is not null
```

`COALESCE` exige un type commun. Ces deux colonnes n'ont pas le même en
production — héritage du formulaire mono-véhicule, antérieur à la table
`vehicules`. PostgreSQL refuse alors la requête **entière**, et pas
seulement cette rubrique : c'est pourquoi plus rien ne s'affichait, pour
aucun véhicule.

Le socle déclarait les deux colonnes en `date` et ne pouvait donc pas
voir le défaut. Il reproduit désormais la divergence.

**Fichiers.** `migrations/101_informations_types_coherents.sql` (nouvelle).

### 3.6 Le compteur « Demandes de devis »

**Cause, double.** Le comptage partait avec la **clé anonyme** — or la
RLS est active sur `clients` depuis les migrations `90` et `91`, donc le
serveur répond `200` avec un total de zéro, sans la moindre erreur
visible. Et un délai d'anti-rafale de **cinq minutes** gelait le badge,
y compris au retour sur l'onglet.

**Fichiers.** `dashboard.html` — `majBadgeDemandes`,
`demarrerSurveillanceDemandes`.

---

## 4. Ce qui a été corrigé

### 4.1 Migration `100` — les activités que le formulaire propose

`activites_partenaire()` devient la **source de vérité**, citée par la
contrainte et comparée au formulaire par les tests. `metiers_partenaire()`
fait de même pour la colonne `metiers`, qui n'était contrainte par rien.

La contrainte est élargie **avec précision**, en reprenant la discipline
de la migration `95` : seules les contraintes `CHECK` portant sur la
seule colonne `activites` et énumérant les trois valeurs historiques
sont remplacées ; tout le reste est laissé en place, avec une trace.

Restent refusés : valeur inconnue, ancienne valeur hors nomenclature,
tableau vide, valeur forgée, mélange d'une valeur valide et d'une
inconnue. `NULL` reste accepté — les candidatures antérieures ne
deviennent pas invalides.

### 4.2 Messages honnêtes, et aucun fichier orphelin

Le détail technique ne quitte plus la console. La fenêtre partenaire a
sa propre zone d'erreur. Le bandeau client est effacé à chaque ouverture
de fenêtre, à chaque nouvel essai et dès le succès.

Les trois documents partent **avant** l'écriture de la candidature : un
échec les laissait orphelins dans le bucket. `_supprimerFichierTeleverse`
les retire désormais.

L'écran de succès distingue quatre issues du `signUp` — `non_demande`,
`cree`, `existe_deja`, `echec` — et dit chacune telle qu'elle est. Une
adresse déjà inscrite n'est plus un échec : on ouvre la session si on
peut, et le nouvel essai avec la même adresse ne crée rien en double. Le
numéro client affiché est celui que le **serveur** a enregistré.

### 4.3 Le mode de transport appartient au véhicule

Le bloc par véhicule est généré **sans condition**. Le contrôle global
est retiré entièrement : HTML, état, `onModeTransport()`, validation,
payload du dossier, CSS résiduel. Le devis lit le mode sur les véhicules
(`_hcPlateauDemande`).

Le **Délai souhaité** (Standard / Prioritaire-urgent) est conservé tel
quel : c'est une donnée globale du dossier, et ce n'est pas le mode de
transport.

Les colonnes `clients.mode_transport` et `clients.plateau` restent en
base, inchangées : les demandes déjà enregistrées les conservent, et le
Dashboard continue de les lire pour celles-là.

### 4.4 Migration `101` — une logique booléenne, pas un cast

```sql
(v.date_prise_en_charge is not null
 or (commun and d.date_prise_en_charge is not null))
```

Strictement équivalent à l'original, sans exiger de type commun. Les
**sept** expressions concernées sont réécrites de la même façon, y
compris celles qui fonctionnaient par chance. Un cast aveugle aurait
masqué le problème et comparé des textes de formats possiblement
différents.

Les règles métier des informations manquantes sont **conservées telles
quelles** et désormais éprouvées : pas d'adresse de prise en charge si
le client dépose, pas d'adresse de livraison s'il récupère, calcul par
véhicule sans report d'un véhicule sur l'autre.

### 4.5 Migration `102` — une période, et une mission unique

* `missions.date_fin_intervention` : la mission porte la période ;
* un **index unique** sur `(client_id)` pour les missions de nettoyage
  non annulées — l'unicité est garantie par la base, quel que soit le
  chemin d'écriture ;
* `creer_mission_nettoyage_si_prete(uuid)` : exige un administrateur, un
  devis **accepté**, et aucune information encore attendue. Idempotente
  par construction ; une course entre deux appels simultanés rend la
  mission gagnante plutôt qu'une erreur.

Le Dashboard n'insère plus directement : il appelle cette fonction, et
le fait **automatiquement** pour chaque demande de nettoyage dont le
devis est accepté, à chaque chargement de la liste.

---

## 5. Le formulaire Nettoyage

### 5.1 Une période, pas un instant

Date de début **et** date de fin. `début = fin` est accepté ; une fin
antérieure au début est refusée, à la saisie comme au calendrier (borne
minimale). La période est enregistrée, affichée au récapitulatif, dans
le Dashboard, le devis et la mission.

### 5.2 La disponibilité, retirée

La question « Quelle est votre disponibilité ? » et ses trois choix —
Heure précise / Créneau horaire / Flexible — sont retirés, ainsi que le
champ d'heure précise, la validation conditionnelle et les clés de
payload `dispo_type` et `heure_precise`.

L'horaire sur place devient une simple plage, **toujours visible et
facultative**. Elle ne dépend plus d'aucun choix préalable, et seule sa
cohérence interne est vérifiée. S'il manque, il est réclamé plus tard
par le mécanisme des informations nécessaires — c'est exactement son
rôle.

> **Hypothèse assumée, faute d'instruction plus précise.** Le prompt
> demandait de retirer la question et « ses anciens champs », tout en
> gardant « les horaires réellement utiles ». Conserver deux mécanismes
> concurrents (heure précise **et** créneau) aurait reproduit la faute du
> mode de transport. Un seul est conservé : la plage. Le choix est
> réversible — remettre un champ d'heure précise ne demanderait qu'un
> ajout, sans rien défaire.

Les demandes **déjà enregistrées** conservent `dispo_type` /
`heure_precise` dans leur JSON : le Dashboard sait encore les lire, et
rien n'est réécrit. La clé `date_souhaitee` ne change pas de sens — elle
reste la date de début.

### 5.3 Le délai commercial

« réponse garantie en moins de 2h » devient « sous 1 heure » sur la page
publique. C'était la dernière occurrence. Un test interdit son retour.

---

## 6. Les devis PDF

Le design n'est pas refait : ni la charte, ni les contenus, ni les
alignements. Seuls quelques titres arrivaient collés à la carte grise
qui les précède. Ils reçoivent **2,6 mm** de respiration, et eux seuls :
*Mission sur site*, *Intervention*, *Informations complémentaires*,
*Prestation(s)*, *Lieu d'intervention*, *Véhicules à nettoyer*.

La même valeur sert **aussi** à mesurer la place nécessaire avant un
saut de page : sans cela, la pagination se déciderait sur une hauteur
qui n'est plus la bonne.

Ce n'est pas jugé à l'œil. Un stub jsPDF instrumenté enregistre les
coordonnées réelles de chaque titre et de chaque carte :

| | Écart mesuré |
|---|---|
| avant | **3,20 mm** pour les six titres visés |
| après | **5,80 mm**, et rien ne sort de la page A4 |

---

## 7. Les e-mails et les adresses `.invalid`

Une erreur EmailJS avait été observée avec `…@example.invalid`. Le
domaine `.invalid` est **volontairement non distribuable** : cet essai
ne prouve aucun défaut du produit.

Les tests interceptent et comptent les envois, sans réseau. **Aucun
e-mail réel n'est parti.** Aucun défaut EmailJS n'a été reproduit
indépendamment de l'adresse volontairement invalide : rien n'a donc été
modifié de ce côté.

---

## 7 bis. Tests réellement exécutés

### Avant correction — chaque anomalie a d'abord été reproduite

| Suite | Commande | Contre le `main` `8b86148` | Après correction |
|---|---|---|---|
| `t_rls.sh` | `bash tests/t_rls.sh` | **22 FAIL** (sans les migrations `100` et `101`) | **364 PASS / 0 FAIL** |
| `t_stabilisation.js` | `node tests/t_stabilisation.js` | **28 FAIL** | **160 PASS / 0 FAIL** |

Les échecs les plus parlants, tels qu'ils sont sortis :

| Contrôle | Ce qu'il a obtenu contre le `main` |
|---|---|
| `X3 bis` — se déclarer technicien | refusé, `23514` |
| `T1` — lire les informations de mission | `COALESCE types date and text cannot be matched` |
| `Dbis1 bis` — un bloc Mode de transport par véhicule | `[{titres:1}, {titres:0}, {titres:0}]` |
| `Dbis1 quater` — un mode envoyé pour chacun | `["standard", "", ""]` |
| `F6` — ouvrir « Devenir client » efface l'erreur précédente | `{"affiche":"block","texte":"Erreur 400 [convoyeurs]: 23514"}` |
| `H-nettoyage3` — titres non collés | écart de `3.20 mm` |

Et les **deux défauts trouvés en revue** (§ 12.0), reproduits de la même
manière avant d'être corrigés :

| Contrôle | Ce qu'il a obtenu contre le code de la PR, avant correction |
|---|---|
| `Dquater2` — aucun mode demandé quand HelixCar ne transporte pas | `[2, 2]` blocs rendus |
| `Dquater3` — et rien de tel en base | `["standard", "standard"]` |
| `U22` — deux appels simultanés, deux références | **2 missions, 1 seule référence distincte** |

Ces trois reproductions ont été **rejouées** sur une copie mutante après
correction, pour vérifier que les contrôles mordent toujours (§ 12.6 et
§ 12.7 en font autant pour le manifeste et pour les libellés).

### Après correction — la campagne complète, depuis zéro

```
npm test
```

**31 suites, 1 798 contrôles, 1 798 PASS, 0 FAIL — en 360 secondes.**

| Suite | PASS | Ce qu'elle couvre ici |
|---|---|---|
| `t_rls` | **364** | migrations réelles sur PostgreSQL 16 jetable — sections S (activités), T (types et règles métier), U (période et mission unique), **U bis** (course sur la référence) |
| `t_stabilisation` | **160** | la suite créée pour ce chantier, sections A → O |
| `t_rattachement` | 73 | rattachement après confirmation, inchangé |
| `t_mission_nettoyage` | 73 | cycle devis → mission, désormais piloté par le serveur |
| `t_video` | 70 | vidéo de candidature, limite de 300 Mo comprise |
| `t_tus` | 59 | envoi reprenable |
| `t_durcissement` | 59 | absence de handlers JS dynamiques |
| `t_nonreg` | 44 | périmètre de fichiers et validations métier |
| `t_nettoyage` | 33 | période, disponibilité retirée, horaire libre |
| *(22 autres suites)* | | non-régression |

**Portabilité des dates**, vérifiée dans les deux fuseaux :

```
TZ=UTC           node tests/t_dates.js    →  19 PASS / 0 FAIL
TZ=Europe/Paris  node tests/t_dates.js    →  19 PASS / 0 FAIL
TZ=UTC           node tests/t_periode.js  →  40 PASS / 0 FAIL
TZ=Europe/Paris  node tests/t_periode.js  →  40 PASS / 0 FAIL
```

**Hygiène du dépôt** :

```
git diff --check origin/main..HEAD   →  aucune anomalie
git status --short                   →  arbre de travail propre
```

**Ce qui n'a été touché à aucun moment** : aucune connexion à Supabase
(`tests/env.js` coupe toute requête sortante), aucune donnée réelle,
aucun e-mail réel, aucun paiement.

### GitHub Actions — observé, jamais prédit

Exécutions nº 24 (poussée) et nº 25 (Pull Request) sur le commit de tête
**`d8a65b8`**, terminées et relues — pas prédites :

| Tâche | Résultat |
|---|---|
| Politiques RLS sur PostgreSQL 16 | ✅ **success** |
| Suites navigateur et sécurité serveur | ✅ **success** — **1 434 PASS / 0 FAIL en 228 s** |

1 434 (CI, 30 suites avec `--sans-sql`) + 364 (`t_rls`, seconde tâche)
= **1 798**, exactement le chiffre mesuré en local.

Le dernier commit de **code** est `5a0c56f` ; `d8a65b8` ne modifie que
ce dossier de recette. Le code réellement exécuté par ces deux
exécutions est donc bien celui de `5a0c56f`.

*Rappel des exécutions précédentes, avant la revue : nº 20 et nº 21 sur
`34b74aa`, toutes deux `success`, 1 345 PASS / 0 FAIL en 163 s.*

---

## 8. Limites des tests, et contrôles manuels restants

Ce que ces tests **ne** couvrent **pas** :

* **Le rendu visuel d'un vrai PDF.** jsPDF vient d'un CDN, coupé par
  principe pendant les tests. La géométrie est mesurée, pas l'aspect.
  → **contrôle manuel** : générer un devis Professionnel et un devis
  Nettoyage depuis le Dashboard, ouvrir les PDF, vérifier à l'œil les
  marges, la respiration des titres cités au § 6 et la pagination.
* **Supabase réel.** Aucun test ne s'y connecte, par construction
  (`tests/env.js` coupe toute requête sortante).
  → **contrôle manuel** après application des migrations : les requêtes
  de vérification sont en fin de chaque fichier `100`, `101`, `102`.
* **L'envoi réel d'un e-mail.** Le modèle, le destinataire, les
  variables et le déclencheur sont vérifiés ; l'acheminement ne l'est
  pas.
  → **contrôle manuel** avec une adresse réelle de test.
* **La divergence de types en production.** Le socle reproduit une
  colonne `text` et une colonne `date`, ce qui suffit à provoquer et à
  corriger l'erreur. Laquelle des deux est `text` **en production** n'a
  pas pu être observée : le correctif est volontairement indifférent au
  sens de la divergence.
  → **contrôle manuel** : `select column_name, data_type from
  information_schema.columns where table_name in ('clients','vehicules')
  and column_name like 'date%';`
* **MP4 et MOV** : le Chromium de test est dépourvu des codecs
  propriétaires (limite déjà connue).

### 8 bis. Ce que la revue de la PR nº 3 n'a **pas** pu prouver seule

Dit franchement, avec le test manuel **exact** qui le remplace.

| Point de la revue | Ce qui est prouvé automatiquement | Ce qui ne peut pas l'être ici | Test manuel exact |
|---|---|---|---|
| **3** — le compte particulier existe vraiment | l'écran de succès n'est affiché **qu'après** relecture du compte, et les quatre issues sont distinctes (section G bis) | l'écriture dans le **vrai** Supabase Auth : `tests/env.js` coupe toute requête sortante, le double `window.__comptes` tient lieu de serveur | créer un compte avec une adresse `test-qa-claude-postpr2+<horodatage>@example.invalid`, puis, dans Supabase → Authentication → Users, vérifier que la ligne existe ; recommencer avec la **même** adresse et vérifier le message « adresse déjà utilisée » |
| **2** — la mission de nettoyage ne dérape pas | index unique, séquence, `est_admin()`, devis accepté, aucune information attendue — sur PostgreSQL 16 **jetable**, avec les vrais fichiers de migration | le comportement sur la base **réelle** : aucune migration n'a été appliquée | après application de `100` → `101` → `102`, exécuter les requêtes de contrôle en fin de chaque fichier, puis `select reference, count(*) from public.missions where type_mission = 'nettoyage' group by 1 having count(*) > 1;` → **aucune ligne** |
| **9** — le sens réel de la divergence de types | l'erreur `42804` est reproduite et supprimée, quel que soit le sens | laquelle des deux colonnes est `text` **en production** | `select table_name, column_name, data_type from information_schema.columns where table_name in ('clients','vehicules') and column_name like 'date%' order by 1, 2;` |
| **§ 14** — aération des devis PDF | la **géométrie** (jsPDF instrumenté, section H) | l'**aspect** : jsPDF vient d'un CDN, coupé pendant les tests | générer un devis Professionnel **et** un devis Nettoyage depuis le Dashboard, ouvrir les deux PDF, vérifier à l'œil les marges, la respiration des titres et la pagination |
| **11** — les protections de la PR nº 2 | 14 marques vivantes, plus les suites qui les exercent (section M) | le comportement des politiques RLS sur le **vrai** projet Supabase | rejouer, sur la base réelle et avec un compte de test, les scénarios de `tests/t_rls.sh` sections V à Z — **jamais** sur des données réelles |

---

## 9. Application des migrations — à faire à la main, dans cet ordre

**Aucune de ces migrations n'a été exécutée.** Elles sont additives et
idempotentes.

| Ordre | Fichier | Objet | Contrôle après application |
|---|---|---|---|
| 1 | `100_activites_partenaire.sql` | débloque les candidatures de technicien | `select public.activites_partenaire();` → 4 valeurs |
| 2 | `101_informations_types_coherents.sql` | rétablit les informations de mission | `select * from public.informations_demande('<uuid>');` → des lignes, aucune erreur `42804` |
| 3 | `102_nettoyage_periode_et_mission.sql` | période de nettoyage, mission unique, **référence sans course** | `select count(*) from pg_indexes where indexname='missions_nettoyage_une_par_demande';` → 1, puis `select last_value from public.missions_nettoyage_numero;` → une valeur **au moins égale** au plus grand numéro de référence déjà émis |

`101` doit venir **après** `100` uniquement pour la clarté du dossier :
les deux sont indépendantes. `102` dépend de `101` (elle interroge
`informations_demande`).

---

## 10. Retour arrière, du moins destructeur au plus destructeur

1. **Ne rien faire.** Les trois migrations n'ajoutent que des
   autorisations qui manquaient, une lecture qui échouait, et des
   garanties. Aucune donnée n'a été modifiée.
2. **Repromouvoir le déploiement Vercel précédent**, sans toucher à la
   base. Les migrations `100` → `102` restent en place sans effet
   néfaste : l'ancienne page les ignore.
3. **Retirer `102`** : `drop function if exists
   public.creer_mission_nettoyage_si_prete(uuid);` puis
   `drop index if exists public.missions_nettoyage_une_par_demande;` et
   `drop index if exists public.missions_nettoyage_reference_unique;`
   — plus rien n'empêche alors deux missions pour la même demande.
   ⚠️ Laisser la **séquence** `public.missions_nettoyage_numero` en
   place : elle ne coûte rien, et la supprimer puis la recréer plus tard
   ferait repartir les numéros de référence en arrière.
4. **Retirer `101`** : réappliquer `94_informations_selon_scenario.sql`.
   ⚠️ Cela **remet** l'erreur `COALESCE types date and text` et le
   Dashboard cesse à nouveau d'afficher les informations de mission.
5. **Retirer `100`** : voir la fin du fichier. ⚠️ Cela **rebloque**
   toute candidature de technicien, et les lignes déjà enregistrées avec
   `technicien` feraient échouer l'ajout de l'ancienne contrainte.
6. **Retirer `missions.date_fin_intervention`** : destructif, les dates
   de fin déjà saisies seraient perdues. À ne faire que si l'on renonce
   définitivement à la période.

Le détail complet est en fin de chaque fichier de migration.

---

## 11. État de chaque point du chantier

| Point | État |
|---|---|
| A1 — candidature vidéo impossible (`23514`) | **FAIT** — migration `100`, socle corrigé, 18 contrôles offensifs |
| A2 — création de compte particulier « bloquée » | **FAIT** — ce n'était pas une écriture, mais un bandeau d'erreur partagé entre deux fenêtres |
| B — faux succès de création de compte | **FAIT** — quatre issues distinctes, dites telles quelles |
| C — structure instable du mode de transport | **FAIT** — un bloc par véhicule, posé sur le **fait métier** (`sc.pc \|\| sc.liv`) et non sur la mise en page ; contrôle global supprimé. La première version, *inconditionnelle*, était une sur-correction : corrigée en revue (§ 12.0) |
| D — erreur SQL des informations de mission | **FAIT** — migration `101`, logique booléenne |
| §10 — logique métier des informations manquantes | **FAIT** — règles conservées, désormais éprouvées (T8 → T16) |
| §11 — Nettoyage : date de fin, disponibilités retirées | **FAIT** |
| §12 — cycle devis → mission Nettoyage | **FAIT** — migration `102`, création automatique et unique |
| §13 — compteur « Demandes de devis » | **FAIT** — jeton de session, délai ramené à 30 s, comptage forcé au retour d'onglet |
| §14 — aération des devis PDF | **FAIT** (géométrie mesurée) — relecture visuelle : **contrôle manuel** |
| §15 — texte commercial « sous 1 heure » | **FAIT** |
| §16 — e-mails et adresses `.invalid` | **NON APPLICABLE** — aucun défaut du produit reproduit |
| Revue — mode de transport sans objet | **CORRIGÉ** — section D quater, rouge puis vert (§ 12.0) |
| Revue — course sur la référence de mission | **CORRIGÉ** — séquence, section U bis, rouge puis vert (§ 12.0) |
| Revue — manifeste fonctionnel des nouveautés | **FAIT** — section N, 22 contrôles de comportement (§ 12.6) |
| Revue — fidélité des formulaires historiques | **FAIT** — section O, 12 contrôles, 140 libellés de référence (§ 12.7) |

---

## 12. Revue critique de la Pull Request nº 3

Cette section rend compte de la **dernière revue critique**, menée avant
toute fusion et avant toute application de migration. Elle ne se
contente pas des tests déjà verts : chaque point a été **re-vérifié en
exécutant du code**, et deux défauts **réels, de mon propre fait**, ont
été trouvés puis corrigés sur la même branche, avec un test rouge avant
et vert après.

### 12.0 Les deux défauts trouvés en revue

#### Défaut nº 1 — une question posée sans objet, et un récapitulatif qui la contredisait

Le lot C avait remplacé le contrôle global « Standard / Sur plateau » par
un bloc **par véhicule**, rendu **sans aucune condition**. C'était une
**sur-correction**. Dans un stockage où le client dépose lui-même son
véhicule **et** vient le rechercher, HelixCar ne le transporte à aucun
moment : la question « Mode de transport » n'a alors pas d'objet.

Pire : la réponse partait quand même en base, alors que le
récapitulatif, lui, testait **une autre condition** et n'affichait rien.
Le client répondait donc à une question absente de son propre
récapitulatif.

La règle juste n'est ni « toujours », ni « seulement si une autre
réponse a été donnée » : c'est **« seulement si HelixCar transporte
réellement ce véhicule »** — le fait métier `sc.pc || sc.liv`, appliqué
**mot pour mot** dans le formulaire et dans le récapitulatif.

* Reproduit puis corrigé : `t_stabilisation.js`, section **D quater**
  (`Dquater1` → `Dquater5`).
* Contre le code de la PR avant correction : `Dquater2` obtenait
  `[2, 2]` blocs rendus là où HelixCar ne transporte rien, et
  `Dquater3` obtenait `["standard", "standard"]` envoyés en base.

#### Défaut nº 2 — deux missions de nettoyage pouvaient porter la même référence

La migration `102` calculait la référence de mission par un
`select max(...)` **juste avant** d'insérer. Deux appels simultanés
lisaient le même « dernier numéro » avant qu'aucun n'ait inséré, et
forgeaient **la même référence**.

Ce n'était pas un cas de laboratoire : le Dashboard appelle la fonction
**en parallèle** (`Promise.all`) pour toutes les demandes prêtes.

* Reproduit sur PostgreSQL 16 avec deux sessions synchronisées :
  **2 missions, 1 seule référence distincte**.
* Corrigé par une **séquence** (`public.missions_nettoyage_numero`), qui
  ne rend jamais deux fois la même valeur, alignée sans jamais reculer,
  plus un index d'unicité défensif posé **seulement** si les données
  existantes le permettent.
* Preuve : `t_rls.sh`, section **U bis** (`U21` → `U24`).

Un troisième nettoyage, sans défaut observable mais dangereux : le
générateur de référence **mort** `_referenceMissionNettoyage()` du
Dashboard, qui portait la même course, a été supprimé plutôt que laissé
en embuscade.

### 12.1 Migrations 100, 101 et 102 — contenu, utilité, idempotence, ordre

| Migration | Ce qu'elle fait | Pourquoi elle est nécessaire | Idempotence |
|---|---|---|---|
| `100_activites_partenaire.sql` | ajoute `technicien` aux activités autorisées | sans elle **aucune** candidature de technicien ne passe (`23514`) | `drop constraint if exists` avant `add`, ciblage **précis** de la seule contrainte d'énumération sur `convoyeurs.activites` |
| `101_informations_types_coherents.sql` | recrée `informations_demande(uuid)` avec une **logique booléenne** au lieu d'un `COALESCE` entre deux colonnes de types différents | sans elle le Dashboard répond `COALESCE types date and text cannot be matched` (`42804`) et n'affiche plus **aucune** information de mission | `create or replace function`, corps entier réécrit à chaque exécution |
| `102_nettoyage_periode_et_mission.sql` | colonne `date_fin_intervention`, index d'unicité, séquence de référence, fonction `creer_mission_nettoyage_si_prete` | sans elle la période de nettoyage n'est pas stockable et rien n'empêche **structurellement** deux missions pour la même demande | `add column if not exists`, `create unique index if not exists`, `create sequence if not exists`, `setval` qui **ne recule jamais**, `create or replace function` |

**`101` expliquée** — c'est le point qui n'avait jamais été détaillé.
La migration `94` comparait, pour sept rubriques, une valeur propre au
véhicule et une valeur commune à la demande, avec un
`coalesce(a, b) is null`. Or **`a` et `b` n'ont pas le même type** :
l'une des deux colonnes est `date`, l'autre `text`. PostgreSQL refuse le
`COALESCE` avant même de regarder les données. `101` remplace donc
chacune des sept expressions par une **logique booléenne** qui ne
compare jamais les deux types entre eux :

```sql
(a is not null or (commun and b is not null))
```

Le correctif est **indifférent au sens de la divergence** : il
fonctionne que ce soit `clients.date_*` ou `vehicules.date_*` qui soit
`text` en production. `101` ajoute au passage la rubrique
`nettoyage_date_fin`, qu'exige la période du § 5.1.

**Ordre.** `100` et `101` sont indépendantes ; `102` **dépend de `101`**
(elle interroge `informations_demande`). L'ordre `100 → 101 → 102` est
donc le seul sûr.

**Aucune des migrations `92` à `99` n'a été retouchée** — vérifié par
empreinte, et re-vérifié dans cette revue.

### 12.2 La mission de nettoyage ne peut pas déraper

| Danger | Ce qui l'empêche | Preuve |
|---|---|---|
| deux missions pour le même devis | index unique partiel `missions_nettoyage_une_par_demande`, **côté base** | `t_rls.sh` U7, U8 |
| déclenchement sans acceptation réelle du devis | la fonction exige un `devis` au statut **`accepte`** | `t_rls.sh` U3, U4 |
| contournement d'autorisation | la fonction exige `est_admin()`, et elle est `security definer` avec `search_path` fixé | `t_rls.sh` U1, U2 |
| mission incomplète | zéro ligne `attendue` dans `informations_demande` exigée avant création | `t_rls.sh` U5, U6 |
| rejeu | retour `DEJA_CREEE`, plus `exception when unique_violation` | `t_rls.sh` U9 → U12 |
| **référence dupliquée** | **séquence** non transactionnelle | `t_rls.sh` **U21 → U24** |

### 12.3 Création d'un compte particulier — jusqu'à l'existence vérifiable

Section **G bis** de `t_stabilisation.js`, 13 contrôles. L'écran de
succès n'est plus une déclaration : le compte est **relu côté serveur**
dans le double de test (`window.__comptes`) avant que le succès ne soit
affirmé. Sont couverts : le parcours simple, le basculement
professionnel → particulier, l'échec puis la reprise, le rechargement,
et l'adresse déjà utilisée. Quatre issues distinctes sont dites telles
quelles : `non_demande`, `cree`, `existe_deja`, `echec`.

### 12.4 Le mode de transport, de 1 à 5 véhicules

Sections **B**, **C**, **D**, **D bis**, **D ter**, **D quater**, **E**
et **K**. Couvert : ouverture, duplication, modification indépendante,
allers-retours Convoyage → Stockage → Convoyage, brouillon
(`radios['veh-i-mode']`), rechargement, reprise, validation,
enregistrement, Dashboard et devis. **Exactement quatre rubriques par
véhicule**, jamais hors de la fiche, jamais dupliquées — et, depuis la
revue, **jamais posées quand HelixCar ne transporte pas** le véhicule.

### 12.5 Le contrôle parasite a disparu, le « Délai souhaité » est resté

Section **A** : `#client-mode`, `#client-plateau`,
`name="mode-transport"` et `onModeTransport` n'existent plus (A1 → A6),
et `A7` exige que le « Délai souhaité » **Standard / Prioritaire** soit
toujours là.

### 12.6 Manifeste **fonctionnel** des nouveautés

> « Le simple comptage des fonctions n'est pas une preuve suffisante. »

C'est exact : une fonction peut exister et ne plus rien faire. La
section **N** de `t_stabilisation.js` (22 contrôles) vérifie donc chaque
nouveauté par un **comportement réellement observé**.

| Nouveauté | Preuve exécutée | Suite qui la couvre |
|---|---|---|
| multi-véhicules, fiches indépendantes | trois fiches rendues ; écrire dans la 2 laisse la 1 et la 3 **vides** | N1, N2 · `t_multivehicules` |
| calendriers de période | le calendrier s'ouvre, propose **Effacer** et **OK**, écrit une date **civile**, et « Effacer » la retire | N3, N4, N5 · `t_dates`, `t_periode` |
| limite vidéo de 300 Mo | un fichier de **300 Mo + 1 octet** est refusé, message à l'appui | N6 · `t_video` |
| contrôle de format vidéo | un `text/plain` est refusé par le **même** chemin | N7 · `t_video` |
| envoi vidéo reprenable | deux envois reçoivent deux **jetons distincts** | N8 · `t_tus` |
| parcours « Trouver un professionnel » | catégorie et métier réellement sélectionnés, payload construit | N9 · `t_pro`, `t_pro_ui` |
| métier « Soutien administratif » | sélectionnable, et son libellé revient exact | N10 · `t_metiers` |
| étapes du parcours professionnel | l'étape 4 ne lui est **pas** applicable, « Continuer » mène au récapitulatif | N11 · `t_etapes` |
| huit métiers de candidature | huit boutons proposés, dont `soutien_administratif` | N12 · `t_metiers` |
| déduction des activités | ajouter un métier déduit bien l'activité `renfort` | N13 · `t_metiers`, `t_decisions` |
| parcours Nettoyage professionnel | ses blocs sont montés, `_nettEstProfessionnel()` vrai | N14 · `t_nettoyage` |
| période de nettoyage | deux bornes civiles, fin **après** début | N15 · `t_nettoyage`, `t_periode` |
| contact sur place transversal | le contact saisi se retrouve **dans le payload** | N16 · `t_contact` |
| devis commun aux quatre services | `_construirePdfDevis` + les quatre services déclarés | N17 · `t_devis`, `t_devis_commun` |
| informations nécessaires à la mission | `informations_demande` des deux côtés | N18 · `t_infos` |
| trois espaces (admin, client, partenaire) | marques vivantes, dont `v_mes_demandes` | N19 · `t_client`, `t_pro_ui`, `t_blocage` |
| charte Dashboard fond blanc | fond blanc déclaré | N20 · `t_charte` |
| décisions multi-activités et blocage | marques vivantes | N21 · `t_decisions`, `t_blocage` |
| missions de nettoyage au Dashboard | `_tenterMissionNettoyage` + l'appel RPC serveur | N22 · `t_mission_nettoyage`, `t_nettoyage_dashboard` |

**Le manifeste mord vraiment.** Pour ne pas se payer de mots, la limite
vidéo a été **desserrée dans une copie** de l'index
(`300 Mo` → `3 000 Mo`) : `N6` est alors passé au **rouge**, exactement
comme il le devait, alors que le nom de la fonction n'avait pas bougé
d'un caractère. La copie a été supprimée aussitôt.

### 12.7 Fidélité des formulaires historiques

Section **O**. Le relevé mécanique des libellés `<label>` de l'ancien
index validé est **versionné** dans `tests/reference_ancien_index.js`
(**140 libellés**). La règle est stricte **dans les deux sens** :

* aucun libellé historique ne peut disparaître sans une raison
  **nommée** ;
* et chaque raison nommée doit correspondre à un libellé qui a
  **réellement** disparu — une liste d'excuses qui grossirait sans objet
  serait, elle aussi, un échec.

**Onze** libellés ont disparu, et **onze** seulement. Chacun a une
raison :

| Libellé disparu | Raison |
|---|---|
| `Quelle est votre disponibilité ? *` | retrait **explicitement demandé** (§ 11) |
| `Heure souhaitée *` | idem — champ de la branche « Heure précise » |
| `Créneau horaire` | idem — choix de la question retirée |
| `Flexible` | idem — choix de la question retirée |
| `Début du créneau *` | devenu **facultatif** : « Début (facultatif) » |
| `Fin du créneau *` | devenu **facultatif** : « Fin (facultatif) » |
| `Quelle est la date souhaitée ? *` | remplacé par une **période** : « Date de début » / « Date de fin » |
| `Mode de transport i *` | contrôle **global** explicitement à supprimer ; la question vit désormais dans chaque fiche véhicule (`.veh-sstitre`, pas un `<label>`) |
| `Quelles activités souhaitez-vous exercer avec HelixCar ? *` | remplacé par les **huit métiers** de la PR nº 2 |
| `Nettoyage automobile` | ancienne case d'activité → métier « Nettoyage » |
| `Renfort automobile` | ancienne case d'activité → cinq métiers de renfort, dont « Soutien administratif » |

L'index actuel propose **158 libellés** contre 140 : les nouveautés ne
sont pas écrasées, elles s'ajoutent. Et les parcours **nouveaux**
restent bâtis sur le code actuel : `O11` et `O12` refusent tout retour
de l'ancien code dans « Nettoyage » et « Trouver un professionnel ».

**La règle mord vraiment.** Le libellé `Immatriculation` a été retiré
d'une copie de l'index : `O2` et `O4` sont passés au **rouge**
(`Immatriculation` non expliqué, 12 disparitions au lieu de 11).

### 12.8 La plage horaire n'a rien ressuscité

Section **L**, 10 contrôles : ni la question « Quelle est votre
disponibilité ? », ni ses trois choix, ni le champ « Heure précise », ni
les trois fonctions qui les pilotaient. Et **aucune validation cachée** :
sans plage, l'étape 4 est **valide** ; seule une plage **incohérente**
est refusée. Le payload ne porte plus `dispo_type` ni `heure_precise`.

### 12.9 L'erreur `COALESCE`, et le SQL brut

Reproduite (`t_rls.sh` T1 contre le socle non migré : `42804`), puis
supprimée par `101`. Section **F** de `t_stabilisation.js` : **aucun**
message technique brut n'atteint l'utilisateur — plus d'écriture dans
`#supabase-debug`, et les bandeaux d'erreur sont nettoyés à l'ouverture
d'une autre fenêtre.

### 12.10 Le compteur de demandes

Section **I** : jeton de session réel, délai de re-comptage ramené à
**30 s**, et re-comptage **forcé** au retour d'onglet
(`visibilitychange`). Une nouvelle demande est donc visible sans
attendre.

### 12.11 Les protections de la PR nº 2 sont intactes

Section **M**, 14 contrôles, chacun par une **marque vivante** et non
par une déclaration : RLS, rattachement après confirmation, **deux
secrets distincts**, absence de handlers JS dynamiques, photos de
mission réellement existantes, verrou serveur des missions,
autorisation interne de `informations_demande`, envoi vidéo reprenable
et Edge Function, `verify_jwt` versionné, isolement réseau des tests,
intégration continue en deux tâches.
