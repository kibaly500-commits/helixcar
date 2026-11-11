# Motorisation par véhicule

Le formulaire vitrine et le formulaire intégré au dashboard partagent les mêmes champs. La motorisation et celle du véhicule à restituer sont facultatives pour le devis ; elles restent absentes du PDF. La complétion utilise une liste de valeurs contrôlée et le circuit existant transmission puis validation admin. Après validation, la valeur est reportée au véhicule (ou au dossier mono historique), puis reprise dans la préparation et la fiche de mission.

Les annonces et candidatures sont filtrées côté serveur sur le badge validé correspondant au métier. Le filtre couvre aussi les anciennes missions disponibles ; les missions déjà attribuées restent consultables par leur partenaire.

Vérifications :

- `node tests/t_motorisation.js`
- `HC_TEST_MOTORISATION=1 PGLITE_MODULE=/chemin/node_modules/@electric-sql/pglite node tests/preparation/sql.cjs`
- `node tests/t_multivehicules.js`
- `node tests/t_d01_complements.js`
- `node tests/t_preparation_missions.js`
- `node tests/t_opportunites.js`

PGlite 0.3.14, installé séparément. `baseline.json` contient les définitions de fonctions antérieures, sans données client. Tous les dossiers et partenaires SQL sont synthétiques et isolés. Aucun e-mail ni paiement réel n’est déclenché.
