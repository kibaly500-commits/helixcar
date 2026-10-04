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
