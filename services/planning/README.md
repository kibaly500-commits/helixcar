# Planning HelixCar manuel

Le calcul Google Maps est arrêté. Aucune clé à configurer sur Vercel.
L’endpoint historique `/api/planning-trafic` répond 410 sans appel externe.

L’onglet Planning HelixCar reste réservé aux administrateurs. Il affiche les
préparations enregistrées avant/après stockage, hors annulations, qui passent au
12 rue de l’Université, 93160 Noisy-le-Grand. Les convoyages directs en sont exclus.

L’administrateur règle l’heure de réception ou de remise dans la préparation,
enregistre puis confirme le rendez-vous dans le planning. Il vérifie lui-même
le trajet et le trafic ; les 45 minutes sont un repère, sans calcul automatique.
Les boutons Clés reçues / Clés remises enregistrent l’instant de validation par
l’administrateur. Ils ne constituent pas une signature électronique du convoyeur.
Les confirmations, la détection des chevauchements et les protections d’accès
existantes restent en place. Aucun changement de schéma ni de mission existante.

Tests : node tests/t_planning_ui.js et node tests/t_preparation_missions.js.

## Passages directs des clients

Le planning reprend aussi les dépôts et retraits des demandes de stockage payées, sans préparation de mission. Le nom du client, le véhicule et les horaires de la demande sont affichés. Le retrait multi-véhicules utilise exclusivement l’heure de chaque véhicule ; le mono utilise celle du dossier. Un véhicule livré après stockage par un convoyeur ne génère pas de retrait client. Les demandes annulées ou non payées sont exclues. Le bouton Voir la demande ouvre le dossier source. Ces rendez-vous clients sont consultatifs : les confirmations et horodatages des clés existants restent réservés aux préparations de convoyage.

Le planning vérifie désormais chaque dossier avec le contrôle serveur `source_preparation_missions` : devis accepté et payé, toutes les informations fournies ou validées, aucune information attendue, transmise à vérifier ou à corriger. Les champs obligatoires de préparation sont aussi vérifiés. Ce contrôle vaut pour les passages clients et convoyeurs ; un échec technique masque les rendez-vous plutôt que de réafficher des données anciennes. Les horaires internes HelixCar peuvent ensuite être fixés par l’administrateur.
