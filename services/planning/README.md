# Planning HelixCar

Le point de calcul est le 12 rue de l’Université, 93160 Noisy-le-Grand.
Les adresses complètes sont reconstruites depuis la demande autorisée sur le serveur.
Aucune adresse transmise librement par le navigateur ne sert au calcul.

## Activation du trafic

Dans les variables d’environnement Vercel des projets de la PR6, ajouter
`GOOGLE_MAPS_ROUTES_API_KEY` pour l’environnement Preview, puis redéployer.
La clé doit autoriser Google Maps Platform Routes API (facturation Google activée),
être limitée à cette API et rester exclusivement côté serveur. Ne jamais la mettre
dans le HTML ou dans un message public. Configurer un quota adapté dans Google Cloud.

Sans cette variable, l’API répond `TRAFIC_NON_CONFIGURE` après vérification de
l’identité administrateur. Les horaires manuels, le planning et les clés restent utilisables.
Aucun trajet fournisseur n’a été vérifié en direct tant que cette configuration manque.

## Horaires

Horaires civils en Europe/Paris ; refus des heures ambiguës/inexistantes au changement
heure été/hiver. Battement par défaut 45 minutes = 20 minutes de remise/état des lieux
et 25 minutes de sécurité. Le battement est réglable entre 20 et 180 minutes.
La réception est estimée à partir de la fin du créneau client. La remise après stockage
est calculée à rebours pour le début du créneau de livraison. La durée est recalculée
au départ prévu ; pas de soustraction d’une durée mesurée à une heure sans rapport.
La restitution fait l’objet d’un trajet distinct et d’une vérification de l’horaire,
avec 20 minutes pour la remise au client avant de repartir.
Le transport sur plateau exige un calcul adapté au véhicule transporteur et n’utilise
pas automatiquement un itinéraire voiture.

Les calculs sont à la demande, pas une surveillance permanente. Les confirmations et
les remises de clés utilisent une révision optimiste et ne sont jamais déplacées
par une nouvelle estimation. Les conflits signalés correspondent aux 20 minutes
physiques de rendez-vous. Une estimation de plus de 15 minutes doit être actualisée
avant application. Les changements de date restent à traiter dans le dossier.

## Données et validation

La migration `20261004172003_planning_helixcar_prive.sql` ajoute la table réservée aux
administrateurs et une RPC SECURITY INVOKER. Aucun changement de mission existante.
Le planning liste les préparations enregistrées passant par HelixCar (hors annulations).
Les détails ne sont pas ajoutés à l’annonce publique du partenaire.

Tests : `node tests/t_planning_calcul.mjs`, `node tests/t_planning_ui.js`,
`node tests/t_preparation_missions.js`. Le test SQL `tests/planning_permissions.sql`
vérifie admin / non-admin / anonyme dans une transaction annulée ; il nécessite
une préparation complète de référence et n’en conserve aucune modification.
