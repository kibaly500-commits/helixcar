# Correction de la facturation du diagnostic — PR6

Le 28 octobre 2026, lecture ciblée de Supabase : la facture de test FAC-2026-5437 de la mission HC-2026-0009 (Diagnostic) portait un total de 0 EUR. La mission terminée et validée pour paiement portait remuneration_prevue=300 et prix_ttc=NULL. Le formulaire utilisait prix_ttc et remplaçait le NULL par zéro.

Correction : la facturation lit en priorité la rémunération explicite. En l'absence de rémunération explicite sur les anciennes missions, elle reprend la règle historique de Mes missions (50 % du prix client, arrondi à l'euro). Une rémunération explicite nulle ou invalide bloque la génération et ne déclenche pas ce repli.

Réparation ciblée de la facture de test non payée : total 0 → 300 EUR, statut validee → en_attente ; date_validation (2026-10-28 12:58:10.36+00) et date_paiement_prevue (2026-11-10 12:58:10.36+00) remises à NULL. Référence, missions, propriétaire et date de génération conservés. Aucun paiement exécuté. Une nouvelle validation administrative est nécessaire. La modification SQL est conditionnée aux valeurs anciennes et à la rémunération 300, à une seule mission terminée et validée pour paiement.

Vérifications : tests de calcul, soumission, montants invalides, sélection multiple, exclusion des missions déjà facturées, validation HelixCar obligatoire, lettre signée pour convoyage uniquement et délai entre factures. Suites mission_nettoyage (74 contrôles) et d01_dashboard (20 contrôles) réussies.

Limites : ces tests sont locaux avec doubles de données. Le parcours navigateur réel complet jusqu'à facturation n'est pas encore terminé. Le calcul du montant et les contrôles de génération restent côté interface : un renforcement serveur transactionnel (montant, validations, doublons concurrents) reste à traiter séparément. Planning non modifié par ce correctif.

## Règle finale confirmée par le propriétaire

Le montant fixé avant publication est la seule source du prix partenaire. Suppression du repli historique à 50 %, y compris dans Mes missions (convoyage et interventions). Un montant absent ne produit aucune facture à zéro : il est signalé « à vérifier ». Les anciennes factures restent inchangées. Le contrôle de la base montre encore des missions historiques sans remuneration_prevue ; aucun montant n'a été inventé ni déduit du prix client pour ces lignes.
