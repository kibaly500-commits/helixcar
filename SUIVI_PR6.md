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
