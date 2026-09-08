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

Les **quatre** fonctions retirées sont exactement celles dont la
suppression était demandée :

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

---

## 9. Application des migrations — à faire à la main, dans cet ordre

**Aucune de ces migrations n'a été exécutée.** Elles sont additives et
idempotentes.

| Ordre | Fichier | Objet | Contrôle après application |
|---|---|---|---|
| 1 | `100_activites_partenaire.sql` | débloque les candidatures de technicien | `select public.activites_partenaire();` → 4 valeurs |
| 2 | `101_informations_types_coherents.sql` | rétablit les informations de mission | `select * from public.informations_demande('<uuid>');` → des lignes, aucune erreur `42804` |
| 3 | `102_nettoyage_periode_et_mission.sql` | période de nettoyage, mission unique | `select count(*) from pg_indexes where indexname='missions_nettoyage_une_par_demande';` → 1 |

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
   `drop index if exists public.missions_nettoyage_une_par_demande;`
   — plus rien n'empêche alors deux missions pour la même demande.
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
| C — structure instable du mode de transport | **FAIT** — un bloc par véhicule, sans condition ; contrôle global supprimé |
| D — erreur SQL des informations de mission | **FAIT** — migration `101`, logique booléenne |
| §10 — logique métier des informations manquantes | **FAIT** — règles conservées, désormais éprouvées (T8 → T16) |
| §11 — Nettoyage : date de fin, disponibilités retirées | **FAIT** |
| §12 — cycle devis → mission Nettoyage | **FAIT** — migration `102`, création automatique et unique |
| §13 — compteur « Demandes de devis » | **FAIT** — jeton de session, délai ramené à 30 s, comptage forcé au retour d'onglet |
| §14 — aération des devis PDF | **FAIT** (géométrie mesurée) — relecture visuelle : **contrôle manuel** |
| §15 — texte commercial « sous 1 heure » | **FAIT** |
| §16 — e-mails et adresses `.invalid` | **NON APPLICABLE** — aucun défaut du produit reproduit |
