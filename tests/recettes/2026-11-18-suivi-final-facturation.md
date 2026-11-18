# HelixCar — recette du suivi final et de la facturation
Date : 18 novembre 2026. Environnement : aperçu PR6, base HelixCar partagée.
Les essais ont utilisé des comptes de test et un PDF explicitement fictif.

## Fonctionnement livré
- Missions : rubrique À valider, accès Suivi et Documents.
- Contrôle final unique des états des lieux, de la lettre et des pièces obligatoires ; historique des décisions.
- Validation finale : mission disponible à facturer, sans déclencher un paiement.
- Partenaire : sélection de missions validées et facture groupée.
- Administrateur : contrôle de facture, correction, validation, puis file À payer.
- Documents privés déposés par HelixCar, les clients et les partenaires ; partage explicite vers le partenaire affecté.
- Dossiers identifiés par leur référence et leur prestation.

## Essais réalisés dans le navigateur
| Scénario | Résultat |
| --- | --- |
| Raccourci du tableau de bord vers À valider | Réussi |
| Mission simulée, états des lieux départ/arrivée consultables | Réussi |
| 100 km prévus, 165 km parcourus : alerte +65 km | Réussi |
| Lettre manquante : validation finale désactivée | Réussi |
| Correction sans commentaire | Refus explicite |
| Correction avec commentaire et historique | Réussi |
| Dépôt de lettre fictive puis retour au suivi | Réussi |
| Validation sans cocher le contrôle manuel | Bloquée par le formulaire |
| Contrôle final confirmé | Mission disponible à facturer ; lettre marquée validée |
| PDF déposé par l’administrateur puis partagé au partenaire | Réussi |
| Ouverture réelle du PDF privé par le partenaire | Réussi |
| Lettre déposée avant les états des lieux | Refus serveur explicite |
| Document complémentaire déposé par le partenaire | Réussi |
| Dépôt client et réception dans la bonne mission côté administrateur | Réussi |
| Liste client limitée à ses dossiers, sans les dossiers du partenaire précédent | Réussi |
| Facture de deux missions fictives (1 EUR + 2 EUR), mission existante exclue | Réussi, total 3 EUR |
| Missions facturées retirées de la sélection | Réussi |
| Motif de correction visible chez le partenaire | Réussi |
| Nouvelle soumission de la même facture | Réussi, référence conservée |
| Actualisation après soumission, sans recharger ni changer de rubrique | Défaut trouvé, corrigé et essai rejoué avec succès |
| Validation administrateur de la facture fictive | Réussi, arrivée dans À payer avec échéance |
| Paiement réel | Non exécuté |
| Partage administrateur vers le compte Test Nettoyage | Non exécuté : contrôle automatique d’autorisation bloquant |

La demande de correction de la facture a été préparée côté serveur avec l’identité administrateur de test ; sa réception et sa nouvelle soumission ont été vérifiées dans le navigateur partenaire. La validation de facture a été effectuée dans l’interface administrateur.

## Tests serveur et automatisés
- Cycle transactionnel avec annulation intégrale : EDL incomplets, restitution manquante, lettre absente, lettre à corriger, contrôle non administrateur, validation répétée, rémunération verrouillée.
- Facturation : montant recalculé par le serveur, doublon interdit, transitions interdites, correction, nouvelle soumission, échéance, passage payé simulé puis annulé.
- Accès aux pièces et au stockage : identité de l’auteur imposée, absence de partage automatique au partenaire, accès après partage et refus pour un tiers.
- Tests locaux réussis : documents de mission (23 contrôles), rémunération, étapes des missions, accordéons clients, recette PR6 et réponses HTTP vides de synchronisation.
- L’ancien test nettoyage reposant sur un navigateur Playwright local n’a pas été exécuté : son navigateur n’est pas installé. Les essais réels ci-dessus ont été conduits dans le navigateur connecté.

## Corrections issues de la recette
- Dépôt client initialement refusé par les règles de stockage.
- Lettre à corriger désormais bloquante ; sa version courante est validée au contrôle final.
- Ancienne mission terminée distinguée d’une mission réellement validée.
- Lien de lettre privée reconnu dans les anciens détails de mission.
- Retour direct des documents au suivi.
- Réponses serveur vides après sauvegarde : reprise correcte de l’actualisation automatique.
- Choix Lettre signée limité aux missions de convoyage.
- Références distinctes pour les dossiers de documents.

## Nettoyage et limites
Les trois missions fictives de recette et les factures fictives ont été retirées après vérification. Aucun paiement réel n’a été effectué et les factures préexistantes ont été conservées. Les PDF de test restent identifiables par le nom HELIXCAR_TEST_DOCUMENT.pdf.

Cette recette couvre le parcours modifié et ses principaux refus. Elle ne constitue pas une garantie de tous les scénarios possibles de toute l’application. Le partage explicite vers Test Nettoyage reste à tester après autorisation.
