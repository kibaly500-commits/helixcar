# Préparation des missions depuis les demandes payées

Le bouton « Préparer les missions » est dans la fiche de demande, sous le devis accepté et payé. L’ouverture relit la demande sans créer de mission. La sauvegarde reste un brouillon administratif ; chaque mission est publiée explicitement après l’aperçu partenaire.

Services : convoyage, collecte/livraison autour du stockage HelixCar, nettoyage entreprise, renfort et technicien automobile. Les trajets de stockage suivent les choix par véhicule. La distance, la motorisation, la rémunération totale et les horaires au point de remise absents de la demande sont à compléter par HelixCar. Aucun montant ni distance n’est estimé automatiquement.

Les opportunités utilisent une projection serveur limitée. Les coordonnées, contacts, plaques, VIN et consignes privées restent dans la mission. Le partenaire retenu peut ouvrir les détails depuis son opportunité ; l’annulation de sa sélection retire cet accès. Les demandes issues d’un paiement test restent dans le périmètre des comptes de recette existants.

## Vérification

- `node tests/t_preparation_missions.js` : planification, préremplissage, brouillon et affichage mobile/PC.
- `node tests/t_opportunites.js` : parcours existant de candidature.
- `node tests/t_mission_nettoyage.js` : protection des photos et validation existantes.
- `node tests/t_pr6_notes_restitution_bandeau.js`
- `node tests/t_pr6_chronologie_restitution_stockage.js`
- `PGLITE_MODULE=/chemin/node_modules/@electric-sql/pglite node tests/preparation/sql.cjs` : PostgreSQL isolé, testé avec PGlite 0.3.14. Installer ce paquet dans un répertoire de test séparé.

`schema.json` contient uniquement des métadonnées de schéma et des fonctions nécessaires, sans lignes client. Les identités et demandes du test sont synthétiques. Le contrôle des informations de dossier y est simulé afin de couvrir ses états bloquants. Cela ne remplace pas une recette du paiement réel, de la livraison des e-mails ou de la mission complète sur le terrain.

Migration : `20260920162027_preparation_missions_devis.sql`. Elle n’effectue aucune publication ni création de mission sur les dossiers existants. Les notifications d’opportunité suivent le mécanisme existant ; cette intégration n’ajoute pas d’envoi d’e-mails aux partenaires.
