# Suivi HelixCar – PR6

## Décisions du 27 octobre 2026

- Priorité : finaliser les annonces, missions, profils et droits associés aux badges.
- La validation administrative de la candidature valide ses métiers initiaux.
- Les métiers demandés après activation restent en attente et nécessitent une décision indépendante. Un refus explicite ne doit pas être annulé automatiquement.
- Travail différé demandé par le propriétaire : créer le système de retenues et récompenses des professionnels. Ne pas le développer maintenant. Définir les règles, montants, motifs, historique et contrôles avec le propriétaire avant implémentation.
- Périmètre : dépôt kibaly500-commits/helixcar, branche codex/helixcar-finalisation-20260910, projet Vercel helixcar-i89b. Ne pas fusionner PR6 ni modifier main.

## Fidélité clients et récapitulatifs — 27 octobre

- Récompenses **clients** désormais autorisées et implémentées (distinctes des retenues/récompenses professionnels différées ci-dessus).
- 1 euro TTC entier payé = 1 point, crédit après fin des prestations du devis, sans double crédit.
- Une box surprise par tranche de 2 000 points ; cinq paliers renouvelés tous les 10 000 points, solde cumulatif conservé.
- Administration > Récompenses : à préparer, prête, envoyée avec historique et dates ; compteur masqué à zéro. Récompense unique par compte/seuil.
- Un retrait de points suspend les box non envoyées devenues inéligibles, sans recréer une box déjà envoyée.
- Mes missions clients : identité partenaire masquée, statuts simplifiés, récapitulatif limité à une mission, évaluation après fin.
- Migration 20261027195656 appliquée à zsetmqnmmupqbkgqbjbo. Aucun ancien dossier actuellement admissible au rattrapage des points.
- Tests ciblés : fidélité 76 contrôles ; récompenses SQL 15 ; UI récompenses/récaps 9 ; offres/badges/compteurs 106 ; références client 7.

## À reprendre le 28 octobre 2026 — demande du propriétaire

- Configurer les e-mails automatiques et vérifier leurs déclencheurs.
- Vérifier les attributions des missions ; définir et finaliser challenges/récompenses professionnels (distincts des box fidélité clients).
- Renseigner le RIB de HelixCar Pro.
- Configurer les notifications au partenaire retenu, y compris SMS.
- Vérifier la fiche mission des partenaires retenus, notamment convoyeurs.
- Brancher Stripe au compte bancaire Qonto du propriétaire.
- Recette complète, convoyage puis autres métiers : devis/paiement → offre selon badges validés → candidature → décision/attribution admin → notification → fiche mission → début → fin → validation HelixCar → archives → disponibilité pour facturation → génération/envoi facture professionnel → réception et suivi admin.
- Vérifier les validations obligatoires, l'absence de doublons et la séparation des comptes. Préserver EDL/lettre de voiture pour convoyage uniquement.
- Cette liste reste à réaliser : les tests de fidélité clients précédents ne valident pas ces intégrations.
- Complément : simuler la fidélité de bout en bout (crédit après paiement/réalisation, pas de doublons, seuils 2 000/10 000/12 000, plusieurs box, suivi admin/client) sans modifier les soldes réels.
- Revoir partiellement l'état des lieux convoyage : ergonomie, fonctionnement et photos/illustrations à identifier avec le propriétaire puis remplacer.
- Actualiser les couleurs/identité HelixCar de la lettre de voiture ; vérifier le PDF et l'impression, conserver les données et signatures.

## Correction des échecs CI — 27 octobre, soirée

- Bug réel corrigé : les boutons « Valider cette réponse » et « Demander une correction » passaient des arguments invalides à actionHtml et pouvaient empêcher le rendu des informations manquantes. La recette clique désormais sur le bouton réellement généré.
- Recettes alignées sur les décisions PR6 : Mes missions attribuées, interventions sans photos obligatoires ni action de démarrage, identité du partenaire masquée au client, nouveaux intitulés métiers, une mission par professionnel, prix arrondis, alerte des devis non lus distincte du compteur total.
- Maintien des contrôles de publication : VIN, chronologie des rendez-vous, données privées et autorisations. Dépendances des scénarios de test réparées ; aucune suite désactivée.
- Lanceur corrigé pour reconnaître également les résumés « N PASS / N FAIL » sans délimiteurs, tout en conservant l’échec sur code non nul ou FAIL explicite.
- Test SQL de restitution rendu indépendant du fuseau de la machine : contrôle de l’heure civile en PostgreSQL, sans conversion implicite JavaScript en UTC. Vérifié en UTC et Africa/Cairo.
- Sur f8d27e3 : contrôles GitHub PostgreSQL 16 (764) et WebKit (820) réussis. Campagne générale relancée sur le correctif final ; consulter GitHub Actions pour son résultat définitif.
- Correctif applicatif f8d27e3 déployé en aperçu sur helixcar-i89b uniquement. main et PR6 non fusionnées. Les intégrations et la recette métier prévues demain restent à réaliser.
