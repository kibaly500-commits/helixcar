# Passation — branche `claude/helixcar-expert-review-p0-p1-qcawh6`

> **Document historique de l'arrêt de Claude.** La reprise du 10 septembre
> 2026 et ses résultats sont dans [REPRISE-CODEX.md](REPRISE-CODEX.md).
> Les mentions « TERMINÉ ET PROUVÉ » ci-dessous ne valident pas les gates
> réels Q01/V01 : réception e-mail, vidéo privée et recette distante restent
> à prouver. Les états F01/D01/O01/X01 ont évolué depuis cette passation.

Document de passation rédigé à l'arrêt du développement, à la demande du
propriétaire (« Codex va reprendre le travail sur ta branche »). Il dit
ce qui est fait, ce qui est prouvé, ce qui ne l'est pas, et la prochaine
action exacte. Rien n'a été déployé, rien n'a été fusionné, aucune donnée
n'a été supprimée, la production n'a pas été touchée.

Base de départ : `origin/main` à `3faf5e0` (merge de la PR nº 4).
Prompt de référence : « HELIXCAR — Révision experte du prompt Claude Code
et direction UX/UI » (9 sept. 2026), décisions C01–C11 définitives.

## 1. État des exigences

Légende : **TERMINÉ ET PROUVÉ** (code + test automatisé vert) ·
**IMPLÉMENTÉ, PREUVE PARTIELLE** (code présent, tests partiels ou non
exécutés sur la version finale) · **COMMENCÉ** · **NON COMMENCÉ** ·
**BLOQUÉ** (impossible dans cet environnement).

### P0

| Lot | Exigences | État | Preuve |
|---|---|---|---|
| V01 | Vidéo de candidature en deux phases (V01-001..) : cause racine = contrainte `convoyeurs_video_coherente` (23514) violée par l'écriture en une fois + garde-fou de la migration 90 refusant la finalisation | **TERMINÉ ET PROUVÉ** | migration `105`, fonction Edge `candidature-video` réécrite ; `t_video_securite.mjs` 144, `t_video.js` 72, `t_video_admin.js` 29, `t_tus.js` 59, section VID de `t_rls.sh` (42) ; reproductions VID-2 / VID-4 sur PostgreSQL 16 |
| Q01 | Envoi réel du devis : cause racine = insertion `return=minimal` sans relecture → devis en mémoire sans identifiant → « Identifiant interne du devis introuvable » | **TERMINÉ ET PROUVÉ** (réception e-mail **BLOQUÉE**) | migration `106`, fonction Edge `devis-secure` (déplacée sous `supabase/functions/devis-secure/`, versions, verrou, journal C11) ; `t_devis_securite.mjs` 82, `t_devis_envoi.js` 38 (reproduction sur origin/main), section DEV (17). Réception sur boîte de recette : aucune boîte ni accès Resend ici → **BLOQUÉ** |

### P1

| Lot | Exigences | État | Preuve / reste |
|---|---|---|---|
| A01 | Connexion unique depuis le site (A01-012), récupération atteignable et consommée (023..030), déconnexion propre (018), sélecteur d'espace mobile + libellé « Espace partenaire » (014/D01-001..003), message anti-énumération effacé (034), Edge `::-ms-reveal` (022), autoremplissage page partenaire (021), pro → particulier (A01-001..011), message « compte créé » honnête | **TERMINÉ ET PROUVÉ** | commit `6ad7a0a` ; `t_a01_connexion.js` 57 (défauts reproduits sur origin/main puis corrigés) ; suites A01 adaptées. Non fait : unification http/https des fonctions d'origine (A01-035..040, P2 domaine) |
| L01 / L02 | Registre de points serveur, paliers 2 000 → 10 000 puis Box mystère (C10), espace client en points, vitrine en points avec cinq icônes, ordre Stockage → Fidélité → Tarifs → Partenaires, challenge convoyeurs inchangé | **TERMINÉ ET PROUVÉ** | migration `109` (agent), `tests/rls/l01.sh`, `t_fidelite.js` 76 (dont section vitrine H) ; commits `0521a46`, `2ac5414`, `fed90a7`, `7a496ea` |
| E01 | Inventaire honnête des e-mails EM0-001..015 | **TERMINÉ** (document) | `tests/RECETTE-EMAILS.md` (agent) : 7 opérationnels non vérifiés en réception, 2 non vérifiés, 20 E-MAIL MANQUANT, réception BLOQUÉE partout |
| O01 (SQL) | Opportunités privées, candidatures uniques, pipeline, attribution atomique N/N, clôture à N/N seulement (C03), journal d'intentions (C11), vues partenaire/admin | **TERMINÉ ET PROUVÉ** (SQL) | migration `108` (agent), `tests/rls/o01.sh` (84 contrôles, dont 1/1, 6/9, 9/9, concurrence) |
| O01 (UI) | Page admin « Opportunités de missions » (brouillon, aperçu partenaire, envoi, pipeline, décisions), page partenaire (cartes, Postuler, état), bouton « Opportunité » sur chaque mission | **IMPLÉMENTÉ, PREUVE PARTIELLE** | dans `dashboard.html` non committé au moment de l'arrêt (committé par cette passation, voir §4). Aucune suite navigateur dédiée (`t_opportunites.js` n'existe pas). Vérifié : syntaxe, actions déléguées et gestionnaires tous résolus, campagne complète (§3) |
| Q02 (SQL) | Voir §7 | **TERMINÉ ET PROUVÉ** (SQL) | migration `110`, `tests/rls/q02.sh` (29) |
| Q02 (UI) | Fiche demande admin : états « Accepté — paiement en attente » / « Payé — informations à compléter » / bouton de création seulement si payé, texte F01-038 retiré ; liste « Mes demandes » du client avec l'état du devis (`v_mes_devis`) | **IMPLÉMENTÉ, PREUVE PARTIELLE** | `dashboard.html` (cette passation). Le double de `t_mission_nettoyage.js` ne connaît pas encore `PAIEMENT_NON_CONFIRME` (voir §3). Consultation/acceptation du devis depuis le Dashboard (Q02-001) : **NON COMMENCÉ** (reste le lien e-mail + `devis.html`) |
| Q02 Stripe | Q02-005..011, 019..025 | **NON COMMENCÉ, par décision** | gate Q01 (réception réelle) non validé ; aucun objet Stripe. Analyse des dépendances : §7 |
| D01 (SQL) | Évaluations réelles (021..024), vue `v_mes_missions` | **TERMINÉ ET PROUVÉ** (SQL) | migration `111`, `tests/rls/d01.sh` (22) |
| D01 (UI Dashboard) | Page « Évaluer » réelle (À évaluer / Historique / badge dynamique), « Mes missions » réelle, « Mon profil » réel, résumé de missions sur l'accueil, onglet « Informations à compléter » regroupé par véhicule avec « Véhicule N — x manquante » et états Complet (011..014), chargement parallèle avec erreurs dites (019), complétion dans le shell (010, cadre intégré `index.html?integre=1&completer=`) | **IMPLÉMENTÉ, PREUVE PARTIELLE** | `dashboard.html` (cette passation) ; pas de suite dédiée. `t_client.js` et `t_demande_integree.js` passent ; `t_infos.js` : 41 PASS / **4 FAIL** (A1, A3, A6, A7 — écrits pour l'ancien rendu de l'onglet, voir « Résultats de la campagne de passation ») |
| D01 (UI site) | Mode intégré sans flash (004), titre/sous-titre/étape identité masqués (005..007), Continuer à sa taille (008), numérotation (009), regroupement par véhicule et enregistrement progressif dans `#modal-completer` (011..016), messages `hc-completion-*` vers le shell | **COMMENCÉ, NON APPLIQUÉ** | script prêt et relu : `tests/passation/scripts/patch_d01_x01_index.py` — il a échoué sur une ancre (indentation des liens du pied de page : 6 espaces, pas 7) et n'a **rien écrit** dans `index.html`. Le shell (`dashboard.html`) est déjà prêt à recevoir ces messages ; sans le script, la complétion s'ouvre dans le cadre mais avec la vitrine derrière |
| X01 (Dashboard) | Pages fictives retirées (Challenge, Pannes, Notations, Panne partenaire, Ma notation, Récompenses), Paramètres sans faux succès, Demandes de recontact sur la table réelle `recontacts`, tableau de bord/missions/profil client réels, profil partenaire sans bandeau ni documents inventés, modales et fonctions mortes retirées, cloche retirée, titres « Bienvenue » neutres, note de la fiche partenaire | **IMPLÉMENTÉ, PREUVE PARTIELLE** | `dashboard.html` + `t_nettoyage_dashboard.js` adapté (46 PASS). RLS de `recontacts` non versionnée : lecture admin **INCERTAINE** (l'écran affiche une erreur honnête si refusée) |
| X01 (site) | Liens morts du pied de page, « 98 % satisfaction » sans source, témoignages inventés, faux succès « Être recontacté », journal de données personnelles | **COMMENCÉ, NON APPLIQUÉ** | même script `patch_d01_x01_index.py` (sections 6–9) |
| X01 (anciennes pages) | `helixcar-cgv-client.html`, `helixcar-contrat-convoyeur.html` (faux succès, orphelines), `helixcar-emails.html` (maquettes 2024) | **NON COMMENCÉ** | suppression prévue avec adaptation de `tests/t_nonreg.js` (E6b, périmètre, fichiers supprimés) |
| F01 | Formulaires, validations, PDF | **COMMENCÉ (agent), NON FUSIONNÉ** | deux sous-lots committés par l'agent dans sa branche de travail + travail non committé, exportés en patchs : `tests/passation/f01/` (§4). Rien n'est fusionné ni testé par la personne qui rédige ce document. Le texte F01-038 est traité dans le bloc mission nettoyage (Q02) |
| P2 U01 / domaine | Proposition UX, configuration par environnement | **NON COMMENCÉ** | seules les origines officielles (production + aperçu) sont déjà dans les deux fonctions Edge (`HELIXCAR_ORIGINES_SUPPLEMENTAIRES`) |

## 2. Causes racines confirmées

1. **V01** — l'écriture `video_url + statut` en une seule requête violait `convoyeurs_video_coherente` (SQLSTATE 23514) ; le garde-fou de la migration 90 refusait ensuite toute finalisation non administrateur. Prouvé par reproduction SQL (VID-2, VID-4) et par le cas réel 214,6 Mo / 119 s (MOV).
2. **Q01** — `sbAuthInsertDevis` insérait avec `Prefer: return=minimal` sans relecture : le devis en mémoire n'avait pas d'`id`, d'où « Identifiant interne du devis introuvable ». Prouvé par `t_devis_envoi.js` section A sur `origin/main`.
3. **A01** — la fenêtre « Nouveau mot de passe » (z-index 500) s'ouvrait derrière l'écran de connexion (z-index 999) ; un drapeau `helixcar_reinit_en_cours` abandonné rouvrait le formulaire à la connexion normale suivante ; `doLogout` n'attendait pas `signOut` et ne réinitialisait ni rôles ni sélecteur. Prouvé par `t_a01_connexion.js` section A sur `origin/main`.
4. **Q02 / C02** — `creer_mission_nettoyage_si_prete` (migration 103) créait la mission sur `devis.statut = 'accepte'` seul ; pendant un paiement confirmé côté serveur (`auth.uid()` nul), `informations_demande` renvoyait zéro ligne et la mission se créait sur un rapport vide ; le verrou de création de la migration 97 refusait la création déclenchée dans la session du client. Les trois points sont traités par la migration 110 (drapeau de transaction `hc.creation_mission_serveur`), prouvés par `tests/rls/q02.sh`.
5. **Tests** — `t_mission_nettoyage.js` D9/D10 passaient parce que l'ancienne `doLogout` levait une exception (double sans `signOut`) avant d'oublier le partenaire : double corrigé (partenaires actifs servis). `t_tus.js` F5 vérifiait l'ancienne colonne `video_chemin` : aligné sur `video_envoi_chemin`.

## 3. Tests

Commandes : navigateur `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome CI_NO_SANDBOX=1 node tests/lancer.js --sans-sql` ; SQL `HC_RLS_DB=verif_x bash tests/t_rls.sh` (PostgreSQL 16 local, root).

Résultats exacts : voir la section « Résultats de la campagne de passation »
en fin de document (renseignée après exécution sur l'arbre committé).

Tests **BLOQUÉS** dans cet environnement : réception réelle d'un e-mail
(devis, confirmation, récupération), Stripe test, rendu PDF visuel comparé
aux devis nº 1/2/3, déploiement des fonctions Edge et des migrations.

Suites **non écrites** : `t_opportunites.js` (UI O01), suite dédiée D01/X01
Dashboard (les contrôles existants couvrent l'espace client réel via
`t_client.js`, `t_infos.js`, `t_demande_integree.js`, `t_nettoyage_dashboard.js`).

## 4. Fichiers

Créés : `migrations/105_…`, `106_…`, `108_…` (agent O01), `109_…` (agent L01), `110_…`, `111_…` ; `supabase/functions/devis-secure/index.ts` (déplacé depuis `index.ts` racine, réécrit) ; `tests/t_video_securite.mjs` (réécrit), `t_devis_securite.mjs`, `t_devis_envoi.js`, `t_a01_connexion.js`, `t_fidelite.js` (agent) ; `tests/rls/README.md`, `rls/l01.sh`, `rls/o01.sh`, `rls/q02.sh`, `rls/d01.sh` ; `tests/RECETTE-EMAILS.md` (agent) ; `tests/passation/**` (ce dossier).

Modifiés : `index.html` (A01, L01/L02), `dashboard.html` (V01 affichage, Q01, A01, L01, X01, D01, Q02, O01 UI), `devis.html` (Q01), `creer-compte-convoyeur.html` (A01 CSS), `supabase/functions/candidature-video/index.ts` (V01), `supabase/config.toml`, `migrations/README.md`, `tests/pg/00_socle_supabase.sql` (colonnes de production), `tests/t_rls.sh` (base nommée, sections), nombreuses suites adaptées (`t_client`, `t_demande_integree`, `t_infos`, `t_roles`, `t_mdp_ui`, `t_motdepasse`, `t_nettoyage_dashboard`, `t_lots_de`, `t_stabilisation`, `t_blocage`, `t_decisions`, `t_mission_nettoyage`, `t_tus`, `t_nonreg`, `t_video*`, `RECETTE-VIDEO.md`).

Non versionné (hors dépôt) : arbres de travail des agents sous `.claude/worktrees/` — leur contenu utile est exporté dans `tests/passation/f01/`.

## 5. Migrations SQL (toutes additives et idempotentes, non appliquées en production)

| Fichier | Contenu | Prouvée par |
|---|---|---|
| `105_video_envoi_en_deux_phases.sql` | colonnes d'envoi en cours, `finaliser_video_candidature` (service_role), garde-fou 90 aligné | section VID |
| `106_devis_versions_et_journal_envois.sql` | versions de devis, `paiement_statut`, `devis_envois` (C11) | section DEV |
| `108_opportunites_missions.sql` | opportunités, candidatures, notifications (intentions), fonctions, vues, triggers | `rls/o01.sh` |
| `109_fidelite_points.sql` | registre `fidelite_mouvements`, paliers, `v_ma_fidelite`, garde-fou paiement, triggers | `rls/l01.sh` |
| `110_paiement_confirme_et_mission.sql` | `paiement_evenements`, `traiter_paiement_confirme` (service_role seul), `creer_mission_nettoyage_si_prete` exigeant le paiement (C02), `creer_mission_si_prete`, déclencheur de complétion, `informations_demande` et `verrou_creation_mission` repris sous drapeau serveur, `v_mes_devis` | `rls/q02.sh` |
| `111_evaluations_et_missions_client.sql` | `evaluations`, `evaluer_mission`, `v_mes_missions` | `rls/d01.sh` |

Attention : l'agent F01 a nommé sa migration **111** (`111_plafonds_mission_et_nettoyage_reserve.sql`, non fusionnée, texte dans `tests/passation/f01/`). À renuméroter **112** avant toute reprise.

## 6. Fonctions Edge et RLS

- `candidature-video` (V01) : envoi en deux phases, en-têtes Range vérifiés, `finaliser_video_candidature` via RPC service_role, CORS deux origines + `HELIXCAR_ORIGINES_SUPPLEMENTAIRES`. Testée via le code réel importé (`t_video_securite.mjs`).
- `devis-secure` (Q01) : déplacée sous `supabase/functions/devis-secure/`, `verify_jwt = false` dans `supabase/config.toml`, actions prepare / send_email (verrou 2 min, journal C11, Resend avec `RESEND_FROM`) / get / accept / refuse avec versions. Variables d'environnement à déclarer : `RESEND_API_KEY`, `RESEND_FROM`, `HELIXCAR_URL_PUBLIQUE`, `HELIXCAR_ORIGINES_SUPPLEMENTAIRES` (voir `migrations/README.md`, « Phase E »). **Non déployée.**
- RLS : aucune politique existante affaiblie. Nouvelles tables toutes fermées (lecture admin ou propriétaire, aucune écriture navigateur) : `devis_envois`, `opportunites`, `opportunite_candidatures`, `opportunite_notifications`, `fidelite_mouvements`, `paiement_evenements`, `evaluations`. Fonctions remplacées sous drapeau de transaction serveur (110) : `informations_demande` (101), `verrou_creation_mission` (97), `creer_mission_nettoyage_si_prete` (103).

## 7. Migration 110 et lot Q02 — état précis

- **Migration 110 : entièrement écrite et testée** sur PostgreSQL 16 (`tests/rls/q02.sh`, 29 contrôles verts dans la campagne SQL de 679) : paiement confirmé serveur seulement (admin et client refusés à l'exécution), idempotence par événement, montant/devise vérifiés, PAYE + mission créée dans la même transaction si complet, mission créée par la dernière information transmise sinon, DEJA_TRAITE / DEJA_PAYE, journal lisible admin seulement, `v_mes_devis` sans jeton ni PDF, un client ne peut toujours pas créer de mission. **Non appliquée en production.**
- **Lot Q02, partie SQL : terminée et testée.**
- **Lot Q02, partie interface : implémentée, preuve partielle** (fiche admin, liste client) — committée par cette passation, sans suite dédiée.
- **Lot Q02, Stripe : uniquement analysé** (dépendances) : le webhook devra appeler `traiter_paiement_confirme(devis_id, 'stripe', event.id, montant, 'EUR', detail)` avec la clé service_role après vérification de signature ; Checkout devra être créé côté serveur à partir de `devis.prix` / `version` / `client_id` (jamais d'un montant navigateur) ; `paiement_evenements` porte l'idempotence ; les remboursements (`rembourse`, `rembourse_partiel`) sont déjà reconnus par la migration 109 (contrepassation des points). Aucun objet Stripe n'existe dans le dépôt.
- **Q02-001 (consultation depuis le Dashboard) : non commencé.**

## 8. Risques et décisions ouvertes

1. C02 rend la création de mission de nettoyage impossible tant qu'aucun événement de paiement serveur n'existe (pas de Stripe) : c'est la règle demandée ; à confirmer que HelixCar l'accepte en l'état, ou décider d'une confirmation manuelle serveur (non prévue par le prompt).
2. Création automatique de mission limitée au nettoyage (`SERVICE_SANS_CREATION_AUTOMATIQUE` pour les autres services).
3. RLS de `recontacts` non versionnée dans le dépôt (lecture admin déjà utilisée par l'archivage) : à versionner.
4. Section « Témoignages » et « 98 % » de la vitrine : retrait prévu (script non appliqué) — décision marketing du propriétaire.
5. Pages légales absentes (liens « Mentions légales », « Politique de confidentialité » sans cible).
6. « Challenge trimestriel » (vitrine) vs « mensuel » (encart) : arbitrage métier.
7. Point de fidélité calculé sur `devis.prix` (HT/TTC non tranché), centimes tronqués, pas d'expiration : documenté dans la migration 109.
8. Le récapitulatif des chemins d'origine (http vs https, quatre implémentations) reste à unifier (P2 domaine).
9. Les scripts de la fonction Edge `devis-secure` n'ont pas été exécutés contre Resend réel.

## 9. Prochaine action exacte

1. Appliquer `tests/passation/scripts/patch_d01_x01_index.py` après avoir corrigé ses ancres de pied de page (`      <a href="#">Convoyage standard</a>` avec **six** espaces, idem pour les huit autres liens), vérifier la syntaxe (`new Function` sur chaque `<script>`), puis relancer `t_infos.js`, `t_demande_integree.js`, `t_client.js`, `t_contact.js`, `t_stabilisation.js`, `t_nonreg.js`, `t_lots_de.js`.
2. Écrire `tests/t_opportunites.js` (double `v_opportunites_*` + RPC 108) et une suite D01/X01 Dashboard, puis relancer la campagne complète.
3. Reprendre F01 à partir de `tests/passation/f01/` (renuméroter la migration en 112, rejouer `git am` des deux patchs sur une branche de travail, relire le diff non committé avant de l'appliquer).

---

## Résultats de la campagne de passation

Exécutée le 2026-09-10 sur l'arbre exactement committé par cette passation
(journal : `campagne_passation.log` du scratchpad de session, non conservé
dans le dépôt). Aucun processus ne tourne encore en arrière-plan.

### Campagne navigateur (`node tests/lancer.js --sans-sql`, 38 suites, 382 s, code de sortie 1)

| Suite | PASS | FAIL | Suite | PASS | FAIL |
|---|---|---|---|---|---|
| t_a01_connexion | 57 | 0 | t_motdepasse | 38 | 0 |
| t_blocage | 35 | 0 | t_multivehicules | 48 | 0 |
| t_brouillon | 18 | 0 | t_nettoyage | 33 | 0 |
| t_charte | 34 | 0 | t_nettoyage_dashboard | 46 | 0 |
| t_client | 37 | 0 | t_nonreg | 52 | 0 |
| t_contact | 20 | 0 | t_periode | 40 | 0 |
| t_dates | 19 | 0 | t_pro | 51 | 0 |
| t_decisions | 53 | 0 | t_pro_ui | 30 | 0 |
| t_demande_integree | 26 | 0 | t_rattachement | 73 | 0 |
| t_devis | 40 | 0 | t_reinit | 38 | 0 |
| t_devis_commun | 52 | 0 | t_roles | 29 | 0 |
| t_devis_envoi | 38 | 0 | t_stabilisation | 162 | 0 |
| t_durcissement | 59 | 0 | t_tus | 59 | 0 |
| t_enregistreur | 26 | 0 | t_video | 72 | 0 |
| t_etapes | 14 | 0 | t_video_admin | 29 | 0 |
| t_fidelite | 76 | 0 | t_devis_securite | 82 | 0 |
| **t_infos** | 41 | **4** | t_video_securite | 144 | 0 |
| t_lots_de | 87 | 0 | | | |
| **t_mission_nettoyage** (campagne) | 71 | **2** | | | |

Total campagne : **1945 PASS / 6 FAIL**.

Relances individuelles après la campagne, sur le même arbre :

| Suite | Résultat | Commentaire |
|---|---|---|
| t_mission_nettoyage | **73 PASS / 0 FAIL** | Les 2 échecs de la campagne (B1, B15) venaient du double de test qui ne portait pas `paiement_statut: 'paye'` ; double aligné sur C02 (`PAIEMENT_NON_CONFIRME` tant que le devis n'est pas payé). Correction committée dans `tests/t_mission_nettoyage.js`. |
| t_nettoyage_dashboard | **46 PASS / 0 FAIL** | Adaptée aux pages supprimées par X01 (D1, D2, E). |
| t_infos | **41 PASS / 4 FAIL** | Inchangée ; échecs détaillés ci-dessous. |

### `t_infos.js` — les 4 contrôles en échec (non corrigés, décision ouverte)

| Contrôle | Attendu par le test | Rendu actuel de `loadInfosClient` (D01, `dashboard.html`) |
|---|---|---|
| A1 « seules les demandes nécessitant réellement quelque chose apparaissent » | TEST-QA-C3 (toutes rubriques fournies/validées) absente de l'onglet | La demande complète est affichée avec `data-complet="1"` et le badge « Complet » (exigences D01-013/014) |
| A3 « le statut de la demande est affiché » | un `badge` contenant `nouveau` | Le statut de la demande n'est plus rendu dans cet onglet (il l'est dans « Mes demandes ») |
| A6 « les informations déjà reçues sont listées » | libellé « Déjà reçues » + « Adresse de livraison » | Remplacé par le compteur « N informations sur M déjà renseignées » et le regroupement par véhicule ; seules les rubriques restantes sont listées |
| A7 « les informations encore attendues sont listées » | libellé « Encore attendues » + « Nom du contact sur place au départ » | La rubrique est bien listée mais sous la forme « Nom du contact sur place au départ manquante » sans l'intitulé « Encore attendues » |

Cause : ces quatre assertions décrivent l'ancien rendu de l'onglet
« Informations à compléter » ; la réécriture D01 (regroupement par véhicule,
états Complet, chargement parallèle) a été livrée sans mettre la suite à jour.
Les 41 autres contrôles (progression sur les rubriques réellement requises,
motif de correction visible, bouton « Compléter mes informations », aucune
donnée interne, écran de complétion, F5, rubriques validées jamais redemandées)
passent. Décision à prendre par Codex : (a) aligner A1/A3/A6/A7 sur le rendu
D01 (afficher les demandes complètes en « Complet » est une exigence D01),
ou (b) revenir à l'ancien rendu si l'exigence antérieure « ne montrer que ce
qui manque » prime. Rien n'a été modifié pour forcer un vert.

### Campagne SQL (`HC_RLS_DB=verif_x bash tests/t_rls.sh`, PostgreSQL 16 local)

**679 PASS / 0 FAIL** sur le commit `00eb6e1` ; aucun fichier SQL
(`migrations/*.sql`, `tests/pg/*.sql`, `tests/rls/*.sh`, `tests/t_rls.sh`)
n'a changé depuis, la campagne SQL n'a donc pas été relancée pour cette
passation. Répartition : socle + migrations 00–06/90–107 (lots V01, Q01,
A01, tests d'infrastructure), `tests/rls/d01.sh` 22 contrôles,
`tests/rls/l01.sh` (109), `tests/rls/o01.sh` (108), `tests/rls/q02.sh`
29 contrôles.

### Tests BLOQUÉS ou non exécutés (rappel)

- BLOQUÉS ici : réception réelle d'e-mails (Resend/EmailJS), Stripe test,
  comparaison visuelle du PDF aux devis nº 1/2/3, déploiement des fonctions
  Edge et des migrations, application des migrations 108–111 sur Supabase.
- Non exécutés car non écrits : `t_opportunites.js` (UI O01), suite dédiée
  D01/X01 Dashboard, suite F01 (`tests/passation/f01/f01.sh.txt` est la
  section SQL exportée du sous-agent, jamais jouée dans `t_rls.sh`).
- Vérifications statiques faites sur l'arbre committé : les 3 `<script>`
  inline de `dashboard.html` passent `node --check` ; 0 occurrence de
  « Page de démonstration » ; toutes les actions déclarées dans
  `HC_ACTIONS` et tous les `onclick`/hooks `showPage` résolvent vers une
  fonction existante.
