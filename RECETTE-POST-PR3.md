# Stabilisation HelixCar après la Pull Request nº 3

> **Rien n'a été fusionné, rien n'a été déployé, aucune migration n'a été
> appliquée sur le Supabase réel, aucun e-mail n'a été envoyé, aucune
> donnée réelle n'a été touchée, aucun paiement n'a été effectué.**

---

## 1. Point de départ

| | |
|---|---|
| Dernier `main` réellement fusionné | `ef50e31` (fusion de la PR nº 3) |
| Branche de travail | `claude/helixcar-etape2-blocage-ecn7qe`, repartie de `ef50e31` |
| Migrations déjà appliquées en production | `92` → `102` — **jamais retouchées** |
| Migrations livrées ici, **non exécutées** | `103`, `104` |

### L'ancien index, vérifié avant usage

Le fichier de référence a été contrôlé avant d'être lu, et il est
**conforme aux trois empreintes annoncées** :

```
792 811 octets            ✅  attendu 792 811
17 189 lignes             ✅  attendu 17 189
3a3f7aa64126156e03ed9f003811a27ac38f6da7ccc513a80071ac2bf77ceb0f  ✅
```

Il n'a servi **qu'en lecture**, et uniquement pour la fidélité des
formulaires historiques. Aucune ligne n'en a été recopiée.

---

## 2. Manifeste comparatif, établi AVANT toute modification

| Fonctionnalité actuelle | Comportement ancien utile | Nouveauté à protéger | Régression constatée | Décision retenue | Test associé |
|---|---|---|---|---|---|
| Candidature partenaire avec vidéo | — | envoi reprenable, Edge Function | **oui** : preflight CORS refusé, aucune candidature ne passait | corriger la liste blanche d'origines | `t_video_securite` 7.16a → 7.16e |
| Période de nettoyage | date unique | période à deux bornes | **oui** : la date de fin écrasait la date de début | rejoindre le composant de période commun | `t_lots_de` D3, `t_stabilisation` section L |
| Mot de passe oublié | — | écran de saisie dans le Dashboard | **oui** : le lien retombait sur la vitrine, sans écran | ajouter l'écran là où le lien atterrit | `t_reinit` (38 contrôles) |
| Rôles d'un compte | un rôle unique | trois espaces distincts | **oui** : une personne à deux casquettes n'atteignait jamais la seconde | rôles demandés au serveur + sélecteur | `t_roles`, `t_rls` W bis |
| Nouvelle demande depuis l'espace client | — | formulaire complet et partagé | **oui** : on quittait le Dashboard pour la vitrine | intégrer le VRAI formulaire dans l'espace | `t_demande_integree` |
| Rubrique « Livraison » du Stockage | — | rubriques par véhicule | **oui** : affichée même quand HelixCar n'intervient pas | masquer sur le fait métier | `t_lots_de` D1 |
| Horaire sur place du Nettoyage | question « disponibilité » | plage horaire libre | non — **évolution demandée** | rendre les deux horaires obligatoires | `t_lots_de` D3, `t_rls` V bis |
| Rubrique véhicules du Technicien | absente | rubrique complète | non — **retrait demandé** | supprimer entièrement | `t_pro` B3, `t_pro_ui` D |
| Encadrés rouges et verts | — | — | **oui** : grands rectangles, alertes natives | composant discret partagé | `t_lots_de` E1 |
| Fond bleu d'autoremplissage | — | — | **oui** | neutraliser la couleur seule | `t_lots_de` E2 |
| Boutons « Effacer / OK » | — | composant stylé | **oui** : HTML brut dans les cartes véhicule | styler par la classe du bouton | `t_lots_de` E3 |
| Calendrier Nettoyage | — | bornes colorées | **oui** : aucun jour intermédiaire marqué | ronds HelixCar, bornes et intermédiaires | `t_lots_de` E4 |
| **Renfort automobile sur site** | — | parcours complet | **aucune** | **strictement inchangé** | `t_pro` D4-5 → D4-7 |
| Structure de la fiche Convoyage | quatre rubriques | quatre rubriques, la 4ᵉ inconditionnelle | **aucune** | **préservée**, re-prouvée à 1/2/3/5 véhicules | `t_lots_de` G1 → G5 |
| Protections de la PR nº 3 | — | RLS, secrets, XSS, photos, vidéo, CI | **aucune** | **préservées** | `t_lots_de` H1 → H9 |

**Règle appliquée en cas de doute** : conserver. Rien n'a été supprimé
par supposition.

### Inventaire des fonctions, mesuré

Règle d'extraction explicite : `^function nom(` en début de ligne,
doublons fusionnés.

```
ancien index validé : 306      main fusionné : 448      après ce lot : 446
index.html      : 16 retirées · 14 ajoutées
dashboard.html  :  0 retirée  ·  5 ajoutées
```

Les **16 retraits** sont **tous** demandés, et nommés :

| Retirées | Pourquoi |
|---|---|
| `_proVehiculesApplicables`, `_proNbVehicules`, `_reinitialiserVehiculesProfessionnel`, `_proMemoriserVehicule`, `_proVehiculesRetenus`, `_proVehiculesPourBrouillon`, `_proRestaurerVehiculesDepuisBrouillon`, `proRendreVehicules`, `_proVehiculeComplet`, `proEffacerVehicule`, `proOkVehicule`, `_proMajEtatVehicules`, `proBasculerVehicule`, `_proMajLibelleVehicules`, `proMajNbVehicules` | la rubrique « Informations sur les véhicules » du Technicien, **dont le retrait est demandé** (lot D4) |
| `_hcEstCalendrierNettoyage` | la sélection temporaire du calendrier Nettoyage, **qui portait le défaut A2** |

### Fidélité aux formulaires historiques

Relevé mécanique des libellés `<label>`, comparé à l'ancien index :

```
ancien index : 140 libellés      index actuel : 159 libellés
disparus     :  11 — exactement les onze déjà expliqués et versionnés
                    dans tests/reference_ancien_index.js
```

**Ce lot n'a fait disparaître aucun libellé historique supplémentaire.**
Vérifié par la section O de `t_stabilisation`, toujours verte.

---

## 3. Lot A — les blocages prioritaires

### A1 — La candidature vidéo, bloquée par le CORS

**Reproduction.** Test rouge écrit d'abord : `7.16a` obtenait `403` et
`7.16b` obtenait `null` au lieu de l'en-tête `Access-Control-Allow-Origin`.

**Cause racine, prouvée.** La liste blanche d'origines de l'Edge
Function ne contenait **que** le domaine d'aperçu :

```ts
const ORIGINES_AUTORISEES = ["https://helixcar-i89b.vercel.app"];
```

Le site réellement utilisé, `https://helixcar.vercel.app`, n'y figurait
pas. `enTetesCors()` n'accordait donc aucun `Access-Control-Allow-Origin`,
le preflight `OPTIONS` répondait `403`, et le navigateur bloquait le
`POST` avant même de l'émettre. Côté console, exactement ce que montre
la photo : *« Response to preflight request doesn't pass access control
check: No 'Access-Control-Allow-Origin' header is present »* puis
`net::ERR_FAILED`.

**Correction.** Les deux origines officielles sont explicitement
autorisées. **Aucun joker** : la comparaison reste une égalité stricte de
chaîne, donc le schéma, le port et le sous-domaine comptent. Cinq
origines hostiles proches sont testées et refusées, dont
`https://helixcar.vercel.app.pirate.invalid`, `http://` et un port
différent.

**Atomicité.** Sur échec de la vidéo, la candidature **reste au statut
`video_attendue`** : elle n'est jamais présentée comme reçue, et la
vidéo peut être renvoyée sans tout ressaisir. Les trois documents
téléversés avant une écriture qui échoue sont supprimés
(`_supprimerFichierTeleverse`), et la fonction `confirmer` nettoie les
fichiers orphelins. Le message affiché est désormais discret et au
design HelixCar — **plus aucune alerte native**.

> **⚠️ Une fusion ne redéploie PAS l'Edge Function.** La procédure exacte
> est au § 9.

### A2 — Nettoyage : la date de fin était impossible

**Reproduction, mesurée.**

```
avant : { debut: "2026-09-18" → écrasé en "2026-09-30",  fin: "" }
après : { debut: "2026-09-18",                            fin: "2026-09-30" }
```

**Cause racine.** La période du nettoyage ne figurait pas dans
`HC_PERIODES_CALENDRIER`. Ses deux champs étaient donc traités comme
deux dates isolées, et `_hcValiderCalendrier()` codait en dur
`getElementById('nett-date')` : choisir une date de fin **écrasait la
date de début** et laissait la fin vide.

**Correction.** Le nettoyage rejoint le composant de période déjà
éprouvé par le Stockage et par « Trouver un professionnel » : ouverture
depuis l'un **ou** l'autre champ, sous-étape début/fin explicite, borne
« la fin ne précède jamais le début » appliquée au rendu avec une
comparaison **stricte** — donc **le même jour reste sélectionnable** —,
effacement, et coloration de la plage. Aucune logique dupliquée.

La sélection temporaire spécifique au nettoyage est supprimée **avec le
défaut qu'elle portait**, ainsi que sa classe CSS devenue morte.

### A3 — Le lien « mot de passe oublié » ne menait nulle part

**Reproduction.** La suite `t_reinit`, exécutée contre le `main` fusionné,
obtient `{modaleOuverte:false, formulaire:false}` et **aucun champ** :
l'écran n'existe pas là où le lien atterrit.

**Cause racine.** Supabase ne redirige vers `redirectTo` que si cette
adresse figure dans ses **Redirect URLs**. Sinon il retombe
silencieusement sur la **Site URL** du projet — la vitrine. Or l'écran de
saisie n'existait que dans `dashboard.html`.

**Correction, en deux temps.** La configuration Supabase reste une
action manuelle (§ 9). Mais surtout **le code devient robuste** :
`index.html` reconnaît désormais le flux de récupération
(`PASSWORD_RECOVERY`, reprise après F5, erreur dans le fragment) et
ouvre un écran dédié.

L'écran demande deux fois le mot de passe, offre les boutons œil, refuse
moins de 8 caractères et deux saisies différentes **sans appeler le
serveur**, n'écrit que par `auth.updateUser` **avec une vraie session de
récupération**, n'annonce le succès qu'après la réponse du serveur, et
nettoie le jeton de la barre d'adresse. Un lien périmé, altéré ou déjà
utilisé ouvre un écran « lien expiré » qui propose d'en redemander un —
**jamais un faux succès**.

**Aucune redirection ouverte** : l'URL de retour est **construite** à
partir de l'origine servie, jamais reprise d'un paramètre, d'un
`referrer` ou d'un champ. Le message de demande reste **identique** que
l'adresse existe ou non.

**Défaut de la même famille, corrigé au passage.** Cinq adresses codées
en dur sur le déploiement d'**aperçu** partaient dans des e-mails
clients : lien de compte convoyeur, fiche de mission, devis, lien du
Dashboard, et l'URL de retour de réinitialisation. Toutes sont
désormais construites à partir de l'origine réellement servie.

---

## 4. Lot B — authentification et comptes multi-rôles

### B1 — Une identité Auth, plusieurs casquettes

**Reproduction, dans `t_rls` et dans cet ordre** : avant la migration
`104`, aucune fonction ne permet de connaître ses rôles, et **aucun index
n'empêche deux fiches pour une même identité**.

**Trois causes distinctes.**

1. `finaliserSessionParUid()` prenait le **premier** rôle trouvé — admin,
   puis partenaire, puis client — et s'arrêtait là. Une personne à deux
   casquettes n'atteignait jamais la seconde.
2. Rien n'empêchait en base deux fiches partenaire, ou deux lignes
   d'administrateur, pour la même identité.
3. La page d'inscription partenaire appelait `signUp()` sans jamais se
   demander si un compte existait déjà, puis rattachait la fiche par un
   **PATCH direct avec la clé anon**. La RLS refuse cette écriture :
   PostgREST répond `204` avec **zéro ligne modifiée**. Le rattachement
   n'avait donc **jamais lieu**, en silence.

**Correction — migration `104`, non exécutée.**

* **Index uniques et partiels** sur `admins(auth_user_id)` et
  `convoyeurs(auth_user_id)`. Ils ne portent que sur les lignes
  réellement rattachées : une candidature déposée sans compte reste
  libre, une candidature **refusée** n'empêche pas de recandidater.
  Posés **seulement si l'existant le permet** — en cas de doublon
  antérieur, un avis est émis et l'administrateur tranche, jamais la
  migration.
* `roles_utilisateur()` : les rôles de la **session en cours**, et
  d'elle seule. **Aucun paramètre, aucune adresse** : impossible de s'en
  servir pour découvrir si quelqu'un d'autre a un compte. Non offerte à
  `anon`.
* `ajouter_role_partenaire(uuid)` : remplace le PATCH anonyme. Exige une
  session, une adresse **confirmée**, et une candidature portant
  exactement cette adresse. **Réponse identique** pour « la fiche
  n'existe pas » et « elle ne vous appartient pas ». Idempotente
  (`DEJA_RATTACHEE`), résistante au double clic et aux appels concurrents.
  **N'écrit jamais dans `admins`** : le rôle administrateur n'est jamais
  auto-attribuable.

**Côté page.** Le Dashboard demande ses rôles au serveur et n'en devine
plus aucun. Un **sélecteur d'espace** apparaît **uniquement à partir de
deux rôles réellement confirmés**, et ne propose que ceux-là. Un clic
bascule **sans aucune reconnexion** et sans fermer la session. Un espace
non attribué est refusé net, même appelé depuis la console. Un espace
qui ne s'ouvre pas n'est jamais présenté comme ouvert.

Si le serveur ne répond pas — ou si `104` n'est pas encore appliquée —
**aucun rôle n'est inventé** : l'enchaînement historique prend le relais.

**Les RLS ne sont pas élargies.** Changer d'espace ne change que
l'affichage. Prouvé : un partenaire ne lit toujours aucune demande d'un
autre (`W-B1-23`), et ne voit que **sa** fiche (`W-B1-24`).

L'inscription partenaire tente **d'abord de se connecter**. Si le compte
existe et que le mot de passe est le bon, elle ne crée rien : elle
ajoute le rôle manquant par la fonction serveur. **Jamais un second mot
de passe pour la même adresse.**

### B2 — La confirmation d'adresse

Le modèle français au design HelixCar est **versionné** dans
`supabase/templates/confirmation-adresse.html`, avec l'objet à recopier
et l'emplacement exact dans Supabase.

Côté code, la page reconnaît l'arrivée par un lien de confirmation :
avec une session elle mène à l'espace, sans session elle ouvre la
connexion avec le message neutre demandé **mot pour mot** — « Adresse
e-mail confirmée, vous pouvez vous connecter. » Le succès n'est
**jamais** affirmé sur la seule présence d'un fragment d'URL : il faut un
événement réel de Supabase, ou une session réellement lue.

### B3 — Les protections de la création de compte

Conservées et re-vérifiées : sections **G** et **G bis** de
`t_stabilisation` (18 contrôles), toujours vertes. Aucune erreur `23514`,
aucune écriture injustifiée dans `convoyeurs`, aucun succès local sans
compte réel, quatre issues distinctes dites telles quelles.

---

## 5. Lot C — l'expérience du Dashboard client

### C1 — La nouvelle demande se fait dans l'espace

**Ce qui était constaté.** « Faire une nouvelle demande » quittait le
Dashboard pour la vitrine : la navigation disparaissait, la barre du
haut aussi, et le client se retrouvait devant la grosse modale publique.

**Correction.** La demande se fait dans une page dédiée de l'espace
client, **barre latérale et barre du haut toujours visibles**, dans un
bloc large et aéré qui suit la largeur de son conteneur.

Le formulaire reste **le vrai formulaire** : exactement le même code,
chargé en mode intégré. **Aucune copie**, aucune règle recopiée, aucun
payload parallèle — une seconde implémentation divergerait le jour même.
Même origine, donc **même session Supabase** : rien n'est transmis par
le navigateur, et le rattachement reste décidé par le serveur à partir
de `auth.uid()`.

Le mode intégré efface la vitrine, retire l'overlay sombre et la croix
de fermeture — c'est « Retour à mes demandes » qui referme — **sans
toucher à une seule question, une seule règle ou un seul champ**. Il
exige d'être **réellement encadré** : ouvrir l'adresse à la main dans un
onglet ne fait rien disparaître.

Après soumission, le formulaire prévient son espace, qui **recharge la
liste depuis la base** : la référence et le statut affichés sont ceux que
le **serveur** a enregistrés, jamais ceux que le message annonce. Le
message n'est accepté **que de notre propre origine ET de notre propre
cadre**.

---

## 6. Lot D — logique métier des formulaires

### D1 — Stockage : la « Livraison » sans objet

**Reproduit.** Avec « Je les dépose moi-même » **et** « Je viens
récupérer les véhicules », chaque fiche affichait quand même une
rubrique « Livraison » numérotée :

```
avant : ["Identité du véhicule", "Livraison", "Une restitution est-elle
         prévue pour ce véhicule ? *", "Restitution", "Véhicule à restituer"]
après : ["Identité du véhicule"]
```

**Une seule fonction porte la règle**, `_livraisonSansObjet()`, consultée
par le rendu, la lecture du payload et la restitution : ils ne peuvent
pas diverger. Les **deux réponses doivent avoir été données**, et données
ainsi : une question encore sans réponse ne fait rien disparaître — c'est
exactement l'erreur qui avait été commise sur le mode de transport.

**Portée stricte** : le Convoyage n'est pas touché, les scénarios mixtes
non plus, et la question « Une restitution est-elle prévue pour ce
véhicule ? » n'est **ni réécrite ni reconditionnée**.

### D2 — Les informations nécessaires suivent le scénario réel

Vérifié, et non supposé — section **V ter** de `t_rls` :

* aucune prise en charge HelixCar réclamée quand le client dépose
  lui-même ;
* aucune livraison ni restitution réclamée quand il récupère lui-même ;
* le **VIN**, explicitement facultatif dans le formulaire, n'est **jamais**
  réclamé ;
* une demande complète ne laisse **rien** d'attendu, et la liste n'est
  pas vide pour autant ;
* un **technicien** ne se voit **jamais** réclamer de véhicule.

La source de vérité est unique : `informations_demande` calcule côté
serveur, à partir des données enregistrées.

### D3 — Nettoyage : horaires obligatoires, et cycle de mission

« (facultatif) » disparaît des deux libellés, l'indicateur obligatoire
apparaît, et **rien n'est prérempli** : une heure inventée serait pire
qu'une heure absente.

`_nettChronologieOk()` compare des **couples date + heure**, jamais deux
heures nues : commencer à 17:00 le lundi et finir à 09:00 le mercredi est
**valide** ; le même jour, la fin doit être strictement postérieure au
début.

Le récapitulatif montre désormais la **période complète** — la date de
fin n'y figurait même pas — et les deux horaires avec exactement les
libellés du formulaire.

**Migration `103`, non exécutée.** Reproduction faite **avant**
correction, dans `t_rls` et dans cet ordre : sans heure de fin, la
demande était présentée comme **complète** (0 information attendue) et
une seule rubrique « Horaire d'intervention » existait. Après `103` :
deux rubriques distinctes, la fin absente est **réclamée**, et la mission
**ne se crée plus** tant qu'elle manque (`INFORMATIONS_MANQUANTES`). Une
fois l'heure fournie, la mission se crée et porte les deux bornes dans
leurs propres colonnes.

Un ancien dossier sans horaire reste **lisible** et passe par le
mécanisme des informations manquantes. Une heure illisible n'empêche
jamais la création : la colonne reste simplement vide.

#### D3 bis — La conversion « défensive » ne l'était pas vraiment

**Trouvé lors de la revue critique finale de la PR, dans mon propre
code.** La création de mission convertissait les valeurs de
`nettoyage_details` — un JSONB écrit par le navigateur — en filtrant
d'abord leur **forme** par une expression régulière. Une forme n'est pas
une valeur. Mesuré sur PostgreSQL 16 :

| Valeur | Passe le filtre | Conversion |
|---|---|---|
| `25:30` | oui (`^[0-2][0-9]:[0-5][0-9]$`) | `::time` → **erreur** |
| `2026-02-30` | oui (`^\d{4}-\d{2}-\d{2}$`) | `::date` → **erreur** |
| `99999999999` | oui (`^[0-9]+$`) | `::integer` → **erreur** |

L'erreur remontait jusqu'à l'appelant :
`creer_mission_nettoyage_si_prete` échouait sur une erreur SQL brute, et
l'administrateur **ne pouvait plus créer la mission du tout** pour ce
dossier. Le commentaire de la migration promettait pourtant l'inverse.

Le contrôle `V-D3-20` ne l'avait pas vu : il utilisait `25:99`, que le
filtre **rejette**, donc la conversion n'était jamais atteinte. La
fenêtre dangereuse est exactement celle que le filtre **accepte**.

**Reproduction d'abord** — six contrôles écrits contre le code en place,
tous en échec :

```
FAIL - V-D3-30 : une heure hors plage (25:30) n'empeche pas la creation
       [attendu: CREEE | obtenu: PL/pgSQL function
        creer_mission_nettoyage_si_prete(uuid) line 61 at SQL statement]
FAIL - V-D3-32 : une date impossible (30 fevrier) n'empeche pas la creation
FAIL - V-D3-34 : un nombre de vehicules hors bornes n'empeche pas la creation
```

**Correction** — le filtre par forme est remplacé par une conversion qui
**tente réellement** et rend `NULL` quand elle échoue
(`§ 2 bis` de la migration `103`) :

```sql
create or replace function public.hc_vers_heure(p text)
returns time language plpgsql immutable strict set search_path = pg_temp
as $$ begin return p::time; exception when others then return null; end $$;
```

Trois fonctions du même modèle — `hc_vers_heure`, `hc_vers_date`,
`hc_vers_entier`. Elles ne lisent aucune donnée, ne décident d'aucune
autorisation et ne sont donc **pas** `security definer` — c'est
vérifié (`V-D3-44`).

Les deux conversions de **date** et celle du **nombre de véhicules**
étaient héritées telles quelles de la migration `102`, déjà appliquée en
production : le défaut existe donc **aussi aujourd'hui**, et `103` le
referme sans jamais retoucher le fichier `102`.

Après correction : **15 contrôles ajoutés** (`V-D3-30` → `V-D3-44`),
`t_rls` passe de 424 à **439 PASS / 0 FAIL**. Aucun contrôle existant
n'a été modifié, affaibli ni supprimé — `V-D3-20` et `V-D3-21` restent
mot pour mot ce qu'ils étaient.

### D4 — Technicien : les informations véhicules retirées

La rubrique n'existait **que** pour cette catégorie
(`_proVehiculesApplicables()` valait `_proCategorie() === 'technicien'`).
Elle est supprimée entièrement : accordéon, compteur, cartes, boutons,
validations, états cachés, styles, mémoire, brouillon et payload.

Le **nombre de professionnels** est conservé — il porte sur des
personnes. Plus aucun véhicule fictif : le Dashboard ne se replie plus
sur `1` pour un professionnel, et le devis Technicien se lit sur la
période, la durée et le nombre de professionnels. Les anciens dossiers
qui portent encore des véhicules restent lisibles.

> **Le Renfort automobile sur site est strictement inchangé**, et c'est
> prouvé : métier, libellé, titre de rubrique et absence de véhicules
> vérifiés avant/après changement de catégorie (`t_pro` D4-5 → D4-7).

---

## 7. Lot E — design et validations

| Point | Cause racine | Correction |
|---|---|---|
| **E1** grands encadrés rouges et verts | `#connexion-message`, `#supabase-debug`, `#conv-erreur-envoi`, `#hc-bandeau-connecte`, `#reinit-alert` portaient un fond et un cadre en style **en ligne** | un composant unique `.hc-note` : fond blanc, texte discret, petit repère vertical rouge — le même que « Ce champ est obligatoire » |
| **E1** alertes natives | neuf `alert()` dans `index.html`, un `prompt()` + un `alert()` dans le parcours « mot de passe oublié » | tous remplacés par le composant partagé |
| **E2** fond bleu d'autoremplissage | le navigateur peint lui-même un fond par-dessus le style HelixCar | `background-clip: text` : le fond peint ne couvre plus que les glyphes. L'autocomplétion, les suggestions et les gestionnaires de mots de passe **continuent de fonctionner** |
| **E3** « Effacer / OK » en HTML brut | le style n'était posé que sur `.veh-sous-ok .veh-sous-*` ; une carte qui utilisait un autre conteneur n'héritait de **rien** | le style suit la **classe du bouton**, quel que soit son conteneur, et tout conteneur d'actions aligne le couple à droite |
| **E4** calendrier Nettoyage | aucune classe intermédiaire n'était posée | rond rouge plein sur chacune des deux bornes, petit rond beaucoup plus clair sur chaque jour intermédiaire. Marqueur posé sur la **seule** grille du nettoyage : le rendu du Convoyage et du Stockage reste inchangé |

**Choix documenté.** Les classes `.alert` de la **console
d'administration** ne sont pas touchées : elles ne sont ni un formulaire
client ni un écran d'authentification, et les convertir toucherait
soixante-dix outils internes sans rapport avec ce qui est constaté. De
même, la ventilation financière colorée du simulateur (part convoyeur /
frais / marge) n'est ni une erreur, ni une réussite, ni une information :
c'est une donnée, et elle garde son code couleur.

---

## 8. Lot F — les devis PDF

* **F1** — « Période et horaires » rejoint la liste des titres aérés, aux
  côtés de « Mission sur site », « Informations complémentaires » et
  « Prestation ».
* **F2** — le devis Nettoyage porte une carte, juste après le bandeau,
  avec les **quatre libellés exacts** du formulaire. Et surtout :
  `ligneLV()` posait la valeur juste après le libellé **sans aucune
  limite de largeur**. Un libellé long — « Horaire de début sur place » —
  additionné à une valeur longue dépassait la carte grise et pouvait
  chevaucher ce qui suit. La valeur est désormais découpée sur la largeur
  réellement disponible, ses lignes suivantes alignées, et la hauteur est
  **mesurée avec exactement le même calcul que le dessin**.
* **F3** — le devis Technicien ne montre plus aucun véhicule et se lit sur
  la durée et le nombre de professionnels. Le devis **Renfort n'est pas
  modifié**.

> **Limite honnête** : la géométrie est mesurée, l'**aspect** ne l'est
> pas — jsPDF vient d'un CDN, coupé par principe pendant les tests. Le
> contrôle visuel reste **à faire à la main** (§ 10).

---

## 9. Tests réellement exécutés

### Chaque anomalie a d'abord été reproduite

| Contrôle | Ce qu'il a obtenu **avant** correction |
|---|---|
| `7.16a` — preflight depuis le domaine de production | `403` |
| `7.16b` — l'en-tête `Access-Control-Allow-Origin` | `null` |
| A2 — choisir une date de fin | la date de **début** passe de `2026-09-18` à `2026-09-30`, la fin reste `""` |
| `t_reinit` A2 — le lien de récupération ouvre un écran | `{modaleOuverte:false, formulaire:false}` |
| D1 — rubriques d'un véhicule, client déposant et récupérant | `["Identité du véhicule", "Livraison", "Une restitution…", "Restitution", "Véhicule à restituer"]` |
| `V-D3-1` — informations attendues sans heure de fin | `0` — la demande passait pour complète |
| `V-D3-2` — rubriques d'horaire | `1` seule |
| `W-B1-1` — moyen de connaître ses rôles | fonction inexistante |
| `W-B1-2` — index empêchant deux fiches par identité | `0` |
| `V-D3-30` — création de mission avec une heure `25:30` | erreur SQL brute, **aucune mission créée** |
| `V-D3-32` — création de mission avec la date `2026-02-30` | erreur SQL brute |
| `V-D3-34` — création de mission avec `99999999999` véhicules | erreur SQL brute |

### Après correction — la campagne complète, depuis zéro

```
npm test
```

**35 suites, 2 071 contrôles, 2 071 PASS, 0 FAIL — en 437 secondes
pour les suites navigateur, plus la suite SQL.**

| Suite | PASS | Ce qu'elle couvre ici |
|---|---|---|
| `t_rls` | **439** | migrations réelles sur PostgreSQL 16 jetable — dont V bis (lot D3, avec les 15 contrôles de la revue finale), V ter (lot D2/D4) et W bis (lot B1) |
| `t_stabilisation` | **162** | les acquis de la PR nº 3, sections A → O |
| `t_mdp_ui` | 88 | affichage des mots de passe |
| `t_lots_de` | **87** | lots D, E, F et G — la suite créée pour ce chantier |
| `t_video_securite` | 77 | Edge Function, dont le CORS du lot A1 |
| `t_rattachement` | 73 | rattachement après confirmation |
| `t_mission_nettoyage` | 73 | cycle devis → mission |
| `t_reinit` | **38** | mot de passe oublié et confirmation d'adresse |
| `t_roles` | **29** | comptes multi-rôles, côté page |
| `t_demande_integree` | **26** | nouvelle demande dans l'espace client |
| *(25 autres suites)* | | non-régression |

**Portabilité des dates**, vérifiée dans les deux fuseaux :

```
TZ=UTC           t_dates    →  19 PASS / 0 FAIL
TZ=Europe/Paris  t_dates    →  19 PASS / 0 FAIL
TZ=UTC           t_periode  →  40 PASS / 0 FAIL
TZ=Europe/Paris  t_periode  →  40 PASS / 0 FAIL
```

### GitHub Actions — observé, jamais prédit

Exécutions nº 37 (poussée) et nº 38 (Pull Request) sur le commit de tête
**`7892a5d`**, terminées et relues :

| Tâche | Résultat |
|---|---|
| Politiques RLS sur PostgreSQL 16 | ✅ **success** — **439 PASS / 0 FAIL** |
| Suites navigateur et sécurité serveur | ✅ **success** — **1 632 PASS / 0 FAIL en 257 s** |

1 632 (CI, 34 suites avec `--sans-sql`) + 439 (`t_rls`, seconde tâche)
= **2 071**, exactement le chiffre mesuré en local.

Les exécutions nº 33 et nº 34, sur le commit `39fe993`, étaient déjà
vertes avec 424 contrôles SQL. Les 15 contrôles de la revue critique
finale (`V-D3-30` → `V-D3-44`) s'y ajoutent : c'est toute la différence
entre 2 056 et 2 071.

**Un échec réel, à la première poussée, et ce qu'il prouve.** L'exécution
nº 31 avait échoué sur `E6 : périmètre de fichiers maîtrisé
[anciens_labels.json]`. Un fichier de travail — une sortie intermédiaire
du script de comparaison des libellés — était entré dans le dépôt parce
que le script l'écrivait avec un chemin **relatif** depuis la racine.
Le garde-fou a fait exactement son travail : rien n'entre sans être
nommé dans le périmètre. Le fichier a été **retiré**, pas la règle
assouplie.

**Hygiène du dépôt** : `git diff --check` — aucune anomalie ; arbre de
travail propre.

**Ce qui n'a été touché à aucun moment** : aucune connexion à Supabase
(`tests/env.js` coupe toute requête sortante, `127.0.0.1` excepté pour la
suite qui a besoin d'une vraie origine), aucune donnée réelle, aucun
e-mail réel, aucun paiement.

---

## 10. Ce qui n'a PAS pu être prouvé automatiquement

Dit franchement, avec le test manuel **exact** qui le remplace.

| Point | Automatisé et prouvé | Ce qui ne peut pas l'être | Test manuel exact |
|---|---|---|---|
| **A1** CORS | le preflight, l'origine accordée, cinq origines hostiles refusées, contre le vrai code de la fonction | le **déploiement** de la fonction : une fusion ne la redéploie pas | après redéploiement (§ 11), déposer une candidature avec vidéo sur `https://helixcar.vercel.app` — vidéo **importée** puis vidéo **enregistrée en direct** ; puis un fichier de plus de 300 Mo, qui doit être refusé avec un message clair |
| **A3 / B2** e-mails | le modèle, l'objet, le bouton, le jeton, l'écran d'arrivée, les liens expirés | l'**acheminement** réel et le rendu dans une vraie boîte | demander un lien depuis `https://helixcar.vercel.app`, ouvrir l'e-mail, vérifier qu'il est en français, cliquer, changer le mot de passe, puis vérifier que **l'ancien ne fonctionne plus** et que le nouveau fonctionne |
| **B1** multi-rôles | index, fonctions, refus, idempotence, sélecteur, RLS non élargies — sur PostgreSQL 16 jetable | le comportement sur la **base réelle** : `104` n'est pas appliquée | après application, se connecter avec une adresse à deux casquettes, vérifier que le sélecteur apparaît et qu'un clic suffit ; puis `select auth_user_id, count(*) from public.convoyeurs where auth_user_id is not null and statut <> 'refuse' group by 1 having count(*) > 1;` → **aucune ligne** |
| **C1** demande intégrée | navigation conservée, vrai formulaire chargé, référence relue depuis la base, message restreint à notre cadre | le confort réel sur **mobile** | ouvrir l'espace client sur téléphone, faire une demande Convoyage puis une demande Nettoyage, vérifier qu'aucune barre de défilement ne se dédouble et que le clavier ne masque pas les champs |
| **E2** autoremplissage | la règle CSS, sur les deux pages | le **rendu réel** de chaque navigateur | sur Chrome, Edge, Safari et Firefox : enregistrer une adresse, revenir sur la connexion, vérifier qu'aucun fond bleu n'apparaît, que la suggestion fonctionne encore et que le focus clavier reste visible |
| **F1/F2/F3** devis | la géométrie, les libellés, le retour à la ligne, la pagination | l'**aspect** : jsPDF vient d'un CDN, coupé pendant les tests | générer un devis **Renfort**, un **Nettoyage un jour**, un **Nettoyage plusieurs jours**, un **Technicien un jour** et un **Technicien plusieurs semaines**, avec un texte court puis un texte très long ; ouvrir les cinq PDF et vérifier qu'aucun texte n'en touche, chevauche ou masque un autre |
| **D3** horaires | la validation, la chronologie, la propagation, la mission | le rendu dans un **e-mail réel** | après application des migrations, accepter un devis Nettoyage et vérifier que l'e-mail reçu porte bien les deux horaires |

---

## 11. Actions manuelles à faire par Hamid, dans l'ordre

> Chaque étape est **nécessaire**. Aucune n'est facultative, et l'ordre
> compte.

### 1. Appliquer les deux migrations, dans cet ordre

Depuis le **SQL Editor** de Supabase, en tant qu'administrateur.

| Ordre | Fichier | Ce que ça débloque |
|---|---|---|
| 1 | `migrations/103_nettoyage_horaires_obligatoires.sql` | les deux horaires de nettoyage réclamés, et la mission qui les porte |
| 2 | `migrations/104_identite_unique_roles_multiples.sql` | une identité, plusieurs casquettes |

`103` dépend de `101` et `102`, déjà appliquées. `104` est indépendante.
Les deux sont **additives et idempotentes** : les rejouer ne fait rien
de plus.

**Contrôles à exécuter juste après**, tels quels :

```sql
-- après 103
select column_name from information_schema.columns
 where table_name = 'missions'
   and column_name in ('heure_debut_intervention','heure_fin_intervention');
-- attendu : 2 lignes

-- après 104
select count(*) from pg_indexes
 where indexname in ('admins_une_ligne_par_identite',
                     'convoyeurs_une_fiche_par_identite');
-- attendu : 2
-- Si 0 ou 1 : relire les messages « notice » de l'application. Des
-- doublons antérieurs ont été signalés et doivent être tranchés à la
-- main AVANT de reposer l'index.

select count(*) from pg_proc
 where proname in ('informations_demande','creer_mission_nettoyage_si_prete',
                   'roles_utilisateur','ajouter_role_partenaire');
-- attendu : 4  (une seule signature par nom)

-- après 103 également : les trois convertisseurs défensifs
select public.hc_vers_heure('25:30')        is null   -- attendu : true
     , public.hc_vers_date('2026-02-30')    is null   -- attendu : true
     , public.hc_vers_entier('99999999999') is null   -- attendu : true
     , public.hc_vers_heure('08:30')                  -- attendu : 08:30:00
     , public.hc_vers_date('2026-12-01')              -- attendu : 2026-12-01
     , public.hc_vers_entier('3');                    -- attendu : 3
-- AUCUNE erreur ne doit remonter : c'est tout l'objet du contrôle.
```

### 2. Configurer les modèles d'e-mail et les URL de redirection

**Supabase → Authentication → URL Configuration**

* **Site URL** : `https://helixcar.vercel.app`
* **Redirect URLs** — ajouter les deux, exactement :
  * `https://helixcar.vercel.app/dashboard.html`
  * `https://helixcar-i89b.vercel.app/dashboard.html`

> C'est **cette liste** qui manquait : sans elle, Supabase retombe sur la
> Site URL et le lien de réinitialisation atterrit sur la vitrine.

**Supabase → Authentication → Emails**

| Modèle Supabase | Objet à saisir | Corps à coller |
|---|---|---|
| **Reset Password** | `Réinitialisez votre mot de passe HelixCar` | `supabase/templates/recuperation-mot-de-passe.html` |
| **Confirm signup** | `Confirmez votre adresse e-mail HelixCar` | `supabase/templates/confirmation-adresse.html` |

Coller le fichier **entier**, commentaire d'en-tête compris ou non — il
ne s'affiche pas. Ne jamais remplacer `{{ .ConfirmationURL }}` par une
adresse figée : le jeton y est porté, et il est à usage unique.

### 3. Redéployer l'Edge Function — une fusion ne le fait PAS

La correction du CORS vit dans
`supabase/functions/candidature-video/index.ts`. **Vercel ne déploie pas
les fonctions Supabase.** Sans cette étape, la candidature avec vidéo
restera bloquée exactement comme aujourd'hui.

```bash
# depuis la racine du dépôt, une fois la PR fusionnée
supabase login
supabase link --project-ref <ref-du-projet-helixcar>
supabase functions deploy candidature-video
```

`supabase/config.toml` est versionné et porte `verify_jwt = false` pour
cette fonction : la commande ci-dessus le reprend automatiquement.

**Contrôle immédiat**, depuis n'importe quel terminal :

```bash
curl -i -X OPTIONS \
  -H "Origin: https://helixcar.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type, apikey" \
  https://<ref>.supabase.co/functions/v1/candidature-video
```

Attendu : `HTTP/2 204`, et un en-tête
`access-control-allow-origin: https://helixcar.vercel.app`.

### 4. Fusionner la Pull Request

Une fois les étapes 1 à 3 faites. Vercel déploie alors `index.html`,
`dashboard.html` et `creer-compte-convoyeur.html`.

### 5. Contrôles de production, dans cet ordre

1. **Candidature partenaire avec vidéo** — une vidéo importée, puis une
   enregistrée en direct. Les deux doivent aboutir.
2. **Mot de passe oublié** — demander un lien, vérifier que l'e-mail est
   en français, cliquer, changer le mot de passe, se reconnecter avec le
   **nouveau**, et vérifier que **l'ancien est refusé**.
3. **Nettoyage** — choisir une date de début **et** une date de fin,
   vérifier que les deux se sélectionnent indépendamment, et que les
   deux horaires sont bien exigés.
4. **Espace client** — « Faire une nouvelle demande » : la navigation
   doit rester visible, et la référence apparaître dans la liste juste
   après l'envoi.
5. **Deux casquettes** — avec une adresse à la fois cliente et
   partenaire : le sélecteur d'espace doit apparaître, et un clic suffire.
6. **Devis PDF** — les cinq cas du § 10, ouverts et regardés.

---

## 12. Retour arrière, du moins destructeur au plus destructeur

1. **Ne rien faire.** Les deux migrations n'ajoutent que des colonnes
   nullables, des index d'unicité et des fonctions. Aucune donnée n'est
   modifiée.
2. **Repromouvoir le déploiement Vercel précédent**, sans toucher à la
   base. Les migrations `103` et `104` restent en place sans effet
   néfaste.
3. **Revenir aux fonctions de `101` et `102`** : réapplique
   `migrations/101_…` puis `migrations/102_…`. ⚠️ L'horaire de fin cesse
   alors d'être réclamé.
4. **Retirer les fonctions de `104`** : `drop function if exists
   public.ajouter_role_partenaire(uuid);` puis `drop function if exists
   public.roles_utilisateur();`. ⚠️ Le sélecteur d'espace cesse de
   fonctionner — la page retombe alors sur l'enchaînement historique,
   sans erreur.
5. **Retirer les index de `104`.** ⚠️ Plus rien n'empêche deux fiches
   pour une identité.
6. **Retirer les colonnes horaires de `103`.** ⚠️ **Destructif** : les
   heures déjà enregistrées seraient perdues.

Le détail complet est en fin de chaque fichier de migration.

---

## 13. Inventaire exact des fichiers

| Fichier | Modifié | Conservé tel quel | Supprimé |
|---|---|---|---|
| `index.html` | mode intégré, écran de récupération, composant de message, période Nettoyage, horaires obligatoires, Livraison sans objet, origine officielle | toute la logique métier des quatre services | la rubrique véhicules du Technicien, la sélection temporaire du calendrier Nettoyage, neuf `alert()` |
| `dashboard.html` | sélecteur de rôles, page « Nouvelle demande », composant de message, devis PDF | l'ensemble de la console d'administration | rien |
| `creer-compte-convoyeur.html` | connexion avant création, rattachement par le serveur | le formulaire lui-même | le PATCH anonyme sur `auth_user_id` |
| `supabase/functions/candidature-video/index.ts` | liste blanche d'origines | tout le reste | rien |
| `supabase/templates/` | **nouveau** — deux modèles d'e-mail | — | — |
| `migrations/103_…`, `migrations/104_…` | **nouveaux**, non exécutés | — | — |
| `migrations/92` → `102` | — | **intouchées** | — |
| `tests/t_reinit.js`, `t_roles.js`, `t_demande_integree.js`, `t_lots_de.js` | **nouveaux** | — | — |
| Autres suites | contrôles renforcés ou inversés, chaque inversion nommée | — | aucun contrôle supprimé |
