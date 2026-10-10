# Recette paiement sans débit

La PR expose, uniquement sur les hôtes de Preview explicitement autorisés, une simulation de paiement pour les dossiers dont l'identité contient le préfixe `TEST-QA-CLAUDE-HELIXCAR`.

Cette simulation n'appelle ni Stripe ni aucun autre prestataire. Elle ne collecte aucune carte et ne produit aucun débit. La réussite appelle côté serveur `traiter_paiement_confirme` avec le fournisseur `test`, le montant et la version relus en base. Les scénarios refusé, abandonné et action supplémentaire conservent le devis en paiement en attente et ne créent aucune mission.

## Parcours

1. Créer un compte et un dossier de recette préfixés.
2. Générer, envoyer et accepter le devis correspondant.
3. Depuis la page du devis dans la Preview, ouvrir « Simulation de paiement — recette ».
4. Vérifier successivement refus, abandon et 3D Secure : aucun paiement ni mission.
5. Choisir réussite : le paiement de recette est journalisé côté serveur.
6. Recharger : le devis reste payé et un rejeu ne crée aucun second traitement.

## Garde-fous

- domaine public refusé par la fonction ;
- JWT client et propriété du devis obligatoires ;
- dossier QA obligatoire ;
- devis accepté et version courante obligatoires ;
- montant et devise issus du serveur ;
- événement unique et traitement idempotent ;
- libellé visible « aucun paiement réel et aucun débit ».

Test automatisé : `node tests/t_paiement_recette.mjs`.


Dossier supplémentaire autorisé explicitement par Hamid le 27/09/2026 : HC-2026-2184 (identifiant serveur 951410e8-7104-4256-b46d-59487e73890a). Les contrôles d’origine, de propriété ou de lien, et de version restent applicables.
