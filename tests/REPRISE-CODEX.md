# HelixCar — reprise Codex du 10 septembre 2026

## Périmètre et point de départ

Reprise de `claude/helixcar-expert-review-p0-p1-qcawh6` depuis le commit
`4beaec1e9fc172aa7045b0e93f2e40006892b23e`, sans repartir de zéro ni
écraser le travail de Claude. La base `origin/main` connue au départ est
`3faf5e019d6566716340f9b31ad7e1ef791332a0`.

Sources : prompt et décisions fournis par le propriétaire,
`tests/PASSATION-CODEX.md`, exports `tests/passation/f01/`, code et tests
de cette branche. Les exports d'origine sont conservés. Aucun déploiement
manuel, aucune migration distante, aucun paiement ni e-mail réel pendant
cette reprise. Aucune fusion dans `main`.

**Implémenté et testé localement ne signifie pas validé en production.**
Les mentions « TERMINÉ ET PROUVÉ » de l'ancienne passation sont des
résultats historiques à périmètre limité : les gates de recette réelle
Q01 et V01 restent ouverts. Aucun résultat SQL rapporté par Claude n'est
présenté comme réexécuté ici.

## Travaux repris et causes des défauts

| Lot / exigences | Observation | Correction dans cette reprise | Preuve / limite |
|---|---|---|---|
| D01-010..019 | `t_infos` : 4 échecs ; état de demande absent, ancien formulaire dans le cadre, sauvegarde globale | Rendu des demandes à compléter compatible avec les acquis ; statut rétabli, informations connues visibles, groupes par véhicule, retrait des demandes complètes de la liste d'actions ; mode intégré précoce ; enregistrement par fiche | `t_infos`, `t_demande_integree`, `t_d01_complements`. RPC simulées, pas de nouvelle preuve RLS distante |
| D01-012..016 | Un enregistrement par véhicule pouvait perdre la saisie encore non envoyée d'un autre véhicule | Envoi limité à la fiche choisie ; conservation des autres champs ; désactivation des champs envoyés pendant la requête ; relecture serveur ; retour explicite si zéro écriture ou relecture impossible ; protection contre une réponse concernant l'ancien dossier | 1/2/3/5 véhicules, panne, double clic, réouverture ; 26 contrôles dans `t_d01_complements` |
| D01-004..009 | Identité et inscription redemandées dans le Dashboard, bouton large parasite | Application du patch préparé par Claude après correction de ses ancres ; conservation du formulaire public et des règles des services | `t_client`, `t_demande_integree`, `t_nonreg`. Pas de refonte UX générale |
| D01-020..024 | Interface missions/évaluations livrée sans suite dédiée | Ajout d'une suite sur les compteurs, les missions éligibles, le barème, le double clic, l'historique, les erreurs et la relecture après rechargement | 18 contrôles `t_d01_dashboard`, dont 3 X01. Les données persistées sont celles du double de recette |
| O01 | Les confirmations et certains refus disparaissaient : `ouvrirOpportuniteAdmin` effaçait la note juste après son affichage | Affichage du résultat après relecture ; distinction publication / e-mail envoyé | 33 contrôles `t_opportunites`, erreur reproduite avant correction |
| O01 / C03 | Interface non couverte après passation | Tests du brouillon, aperçu, publication explicite, pipeline, candidature unique, refus concurrent, état 6/9 « À pourvoir », absence de coordonnées dans les cartes | Tests UI seulement. La RLS, l'éligibilité réelle, les sélections concurrentes serveur et les notifications exigent aussi la recette SQL/externe |
| F01-023..029 / C04 | Les quatre blocs professionnels étaient à l'étape du choix du service | Reprise de l'export F01 : choix du service → étape 3 métier → récapitulatif ; icône stylo ; aucune étape véhicule artificielle | Suites pro, UI, étapes, brouillon, client, stabilisation ; Renfort conserve ses questions/règles hors corrections explicitement demandées |
| F01-035..036 / C01 | Plafonds absents ou comptage navigateur différent du serveur | Mission 166, Type de mission 156 ; compteur Unicode en points de code ; refus des frappes/collages excessifs sans tronquer ; ancien brouillon long conservé et bloqué ; espaces conservés dans le payload et le brouillon | 37 contrôles `t_f01_formulaires` ; nouvelle migration 112 préparée, non exécutée ici |
| F01 / sécurité serveur | Changer uniquement la catégorie pouvait contourner le plafond de Renfort | La migration 112 revalide si le texte **ou la catégorie** change, sans bloquer les autres modifications d'un ancien dossier long | Cas serveur supplémentaires dans `tests/rls/f01.sh`, non exécutés |
| F01-010..011 | Nettoyage encore sélectionnable par un particulier dans des fixtures et dans l'option de service | Radio réellement désactivé, « Réservé aux entreprises », synchronisation type/rendu/brouillon ; changement pro → particulier retire le choix ; contrôle serveur préparé | Front testé ; contrôle SQL non prouvé dans cet environnement |
| F01-007/034/037 | Ancien « Flexible », libellé Nettoyage long ; dates parfois affichées la veille hors Europe | Conservation seulement des heures réellement saisies ; « Préparation complète » ; dates civiles sans conversion UTC, horodatages concernés en Europe/Paris | `t_dates_devis` : 16 contrôles dans Paris, Los Angeles, UTC, Auckland ; suites devis remises au vert. Pas de comparaison visuelle des PDF 1/2/3 |
| X01 | Recontact affiché réussi avant la réponse ; liens vides, pourcentage et témoignages statiques non sourcés | Succès recontact après réponse positive seulement ; verrou double clic ; suppression du journal de coordonnées ; liens utiles corrigés ; retrait des témoignages non sourcés et du pourcentage ; liens juridiques absents indiqués indisponibles | Tests contact, client, lots D/E et non-régression. X01 global reste partiel, voir reste à faire |
| Tests | Certaines suites cherchaient les questions pro à l'étape 2 ou sélectionnaient Nettoyage comme particulier | Parcours de test alignés sur C04/F01, sans désactiver les nouvelles règles | Assertions conservées et renforcées : visibilité réelle / dimensions non nulles |
| Tests / blocage | Campagne : double de base vide après un rechargement en `file://`, puis relance isolée verte | La suite `t_blocage` utilise désormais une origine HTTP locale stable, sert uniquement le Dashboard et conserve les mêmes assertions de persistance | 35 contrôles réussis dans la dernière campagne complète ; ne constitue pas un correctif du serveur métier |

## Fichiers et migrations

- Application : `index.html`, `dashboard.html`.
- Migration nouvelle : `migrations/112_plafonds_mission_et_nettoyage_reserve.sql`.
  La 111 d'origine de l'export F01 a été renumérotée 112 ; la 111 D01
  déjà committée n'est pas écrasée. Aucune migration 00–111 retouchée.
- Tests nouveaux : `t_opportunites.js`, `t_d01_dashboard.js`,
  `t_d01_complements.js`, `t_f01_formulaires.js`, `t_dates_devis.js`,
  `rls/f01.sh`, helper `preuves-qa.js`.
- Tests adaptés : `lib.js`, `t_blocage.js`, `t_brouillon.js`, `t_client.js`,
  `t_etapes.js`, `t_lots_de.js`, `t_pro.js`, `t_pro_ui.js`,
  `t_stabilisation.js`, `t_rls.sh`.
- Documentation : ce rapport, README migrations/RLS, note en tête de la
  passation historique, note de mise à jour de l'inventaire e-mail.
- Script de passation réparé :
  `tests/passation/scripts/patch_d01_x01_index.py`. Il sert de trace du
  patch préparé ; **ne pas le rejouer sur cette branche déjà corrigée**.
- Aucune Edge Function, configuration Supabase/Vercel ou politique RLS
  existante modifiée par cette reprise. Le contrôle SQL 112 est additif
  et n'accorde pas de privilèges supplémentaires.

## Tests exécutés pendant cette reprise

Environnement : Node 24.19.0, Playwright 1.49.1, Chromium headless shell
1148, machine Linux. Les requêtes externes sont bloquées par
`tests/env.js`. Le serveur temporaire de `t_blocage` écoute uniquement
sur `127.0.0.1` et se ferme en fin de suite.

**Dernière campagne complète : 43 suites, 2 086 PASS / 0 FAIL,
code de sortie 0, durée 301 secondes, le 10 septembre 2026.**
Cette campagne utilise `--sans-sql` : elle ne prouve ni l'exécution de la
migration 112 ni une opération sur les services réels.

Commandes reproductibles :

```sh
npm ci
npx playwright install chromium
CI_NO_SANDBOX=1 node tests/lancer.js --sans-sql
```

Dans cet environnement, le navigateur est sélectionné explicitement :

```sh
CHROME_PATH=/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell \
CI_NO_SANDBOX=1 node tests/lancer.js --sans-sql
```

Les contrôles de syntaxe des 11 scripts inline d'`index.html` et des
3 de `dashboard.html`, `bash -n tests/t_rls.sh tests/rls/f01.sh` et
`git diff --check` ont réussi. Ce ne sont pas des tests SQL.

Historique utile des campagnes, conservé sans masquer les échecs :

1. Après première intégration : 40 suites, **1896 PASS / 6 FAIL**,
   code 1. Deux suites interrompues (ancien parcours), quatre assertions
   de dates incorrectes. Les PASS des suites interrompues ne sont pas
   comptés par le lanceur.
2. Après corrections et nouvelles suites : 43 suites,
   **2051 PASS / 1 FAIL**, code 1. `t_blocage` a perdu l'état de son double
   au rechargement et s'est interrompu ; les autres suites ont réussi.
   Le « 1 FAIL » du lanceur représente ici une suite interrompue, pas une
   seule assertion métier.
3. Après passage de `t_blocage` sur origine HTTP locale : résultat final
   ci-dessus. Les échecs précédents ne deviennent pas rétroactivement PASS.

### Captures de composants, pas de production

Les cinq captures de `tests/preuves/reprise-codex/` montrent l'application
locale avec des données **TEST-QA-CLAUDE-HELIXCAR simulées**. Elles ont été
inspectées visuellement ; elles ne prouvent ni connexion réelle, ni SQL,
ni e-mail. Le parcours F01 photographié est le **formulaire public** ; le
composant de complétion est sa vue modale. Ce ne sont pas des captures
d'un Dashboard connecté à des données réelles.

- `d01-complements-mobile.png` : fiche 1 enregistrée, fiche 2 encore à compléter.
- `f01-plafond-1280.png`, `f01-plafond-390.png` : ancien brouillon à 204
  caractères conservé mais refusé par la limite 156, jamais tronqué.
- `o01-opportunite-desktop.png`, `o01-candidature-mobile.png` : carte
  partenaire et candidature reçue par le double, sans coordonnées client.

Pour les régénérer : `HC_CAPTURES_QA=1` avec les suites
`t_d01_complements`, `t_f01_formulaires`, `t_opportunites`. Les tests
responsive et contextes privés Playwright restent des émulations, pas
des essais sur un véritable iPhone.

## Blocages réels et reste à faire

| Point | État exact / prochaine preuve |
|---|---|
| Migration 112 / RLS | **NON EXÉCUTÉ ici** : PostgreSQL absent. Installation indisponible, puis refus de permissions système lors de la préparation ; aucun contournement. `bash -n` ne valide pas le SQL. Exécuter le job GitHub Actions PostgreSQL 16 existant ou un environnement local de recette explicitement équipé |
| Gate Q01 | **BLOQUÉ** : envoi, réception et ouverture d'un devis réel dans une boîte autorisée non validés. Les tests passent avec doubles ; cela ne prouve pas la livraison d'un e-mail |
| Gate V01 | **BLOQUÉ** : parcours réel avec objet vidéo privé, finalisation dans Supabase, présence admin et connexion partenaire non réexécuté. Aucun téléversement vers la production |
| Stripe / Q02 | **NON COMMENCÉ dans cette reprise**, conformément au gate Q01. Ne pas engager Stripe test/réel avant les preuves requises. Q02-001 (consultation depuis le Dashboard) reste à reprendre ; ne pas annoncer le cycle paiement–mission terminé |
| PDF | Tests de génération et contenu avec jsPDF doublé, dates corrigées. **Comparaison visuelle des PDF tests 1/2/3 BLOQUÉE** : baselines approuvées non identifiées dans le dépôt. Ne pas présenter les captures HTML comme preuves PDF |
| E-mails | Aucun nouvel envoi branché. `tests/RECETTE-EMAILS.md` reste l'inventaire ; aucune réception nouvelle certifiée. Notifications opportunité/partenaire retenu/client trouvé toujours manquantes ; propositions de modèles à faire approuver avant envoi |
| D01 restant | Recette réelle des manques selon tous scénarios et des permissions ; vérification des droits après attribution ; suivi global avant/après mission. Les essais navigateur ne remplacent pas ces preuves |
| X01 restant | Anciennes pages orphelines signalées par Claude (`helixcar-cgv-client.html`, `helixcar-contrat-convoyeur.html`, `helixcar-emails.html`) non traitées ici ; audit complet de toutes les routes/faux succès restant. Mentions légales et confidentialité non inventées : liens non opérationnels signalés |
| Fidélité C10 | Aucune récompense ni règle financière nouvelle inventée dans cette reprise ; décisions encore absentes sur avantages supérieurs, base/centimes/remboursements à confirmer avant activation |
| UX U01 / domaine | Proposition importante à valider avant implémentation. Pas de refonte générale, aucun DNS, domaine, cookie/CORS ou réglage Vercel/Supabase changé |

Les corrections validées C01=156, C02=paiement confirmé et informations
complètes, C03=« À pourvoir » jusqu'à N/N, C04=déplacement d'étape sans
réécriture du métier restent la référence. Ne pas redemander ces choix.

## Reprise suivante

### Historique de sauvegarde et autorisation de publication

Le code testé est conservé dans le commit local
`711d68bbc2364cd54832c43b84cf2fa1aafab787`.
Le `git push` n'a pas abouti : aucun identifiant Git configuré dans le
terminal. La connexion GitHub configurée a confirmé des droits d'écriture,
mais son contrôle de sécurité a ensuite refusé la publication du code
métier et de la migration dans le dépôt **public**
`kibaly500-commits/helixcar`, faute d'accord explicite sur cette publication
publique. Le travail a alors été arrêté sans contournement.

Un objet Git correspondant au seul helper `tests/preuves-qa.js` a été
transmis avant le refus, sans être attaché à une branche ; aucune référence
distante n'avait été mise à jour à ce premier arrêt. La branche distante
était encore au commit de Claude
`4beaec1e9fc172aa7045b0e93f2e40006892b23e`, sans nouvelle PR ni campagne CI.

Le propriétaire a ensuite confirmé explicitement la publication du code
métier et de la migration SQL sur le dépôt public ainsi que la création
d'une PR en brouillon, **sans fusion**. La transmission reprend donc via
la connexion GitHub configurée ; aucun identifiant n'est demandé dans la
conversation. Les résultats CI de cette publication doivent être relevés
séparément des 2 086 contrôles locaux ci-dessus. Cette autorisation ne
couvre ni migration distante ni mise en production.

1. Lire ce rapport **avant** la passation historique et contrôler la
   branche distante/les résultats CI du commit livré.
2. Si le job SQL ne peut pas tourner, garder 112 « implémentée, non
   prouvée » ; ne jamais l'appliquer directement à la production.
3. Ouvrir la recette Q01/V01 dans l'environnement autorisé, avec boîte
   de recette autorisée, sans secret transmis dans les messages.
4. Conserver Stripe bloqué tant que le gate devis n'est pas entièrement
   validé. Reprendre les lots restants en distinguant cause, code, test,
   preuve réelle et déploiement.

La PR est un point de revue, pas une autorisation de fusionner ni de
déployer. Aucun « tout est corrigé » : les limites ci-dessus font partie
du livrable.
