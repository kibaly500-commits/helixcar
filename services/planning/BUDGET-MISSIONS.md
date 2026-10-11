# Préparation automatique des missions

Le calcul réserve 30 % du devis payé (arrondi au centime supérieur), puis répartit le solde. Les frais de route et la garde (10 €/jour) sont prélevés dans ce solde. Le restant est pondéré par le barème progressif kilométrique existant. Les centimes résiduels suivent la méthode du plus grand reste. Les missions publiées sont déduites à leur prix figé. Le dépassement bloque la proposition et les validations de cet écran.

Le calcul démarre à l'ouverture d'un dossier convoyage dont tous les prix sont vides. Le bouton global permet un recalcul explicite des brouillons. Les prix existants ne sont pas remplacés à l'ouverture. Les modifications restent en brouillon jusqu'à l'enregistrement ; aucune publication ni paiement automatique.

Les gardes confiées au convoyeur sont distinguées du stockage au dépôt. Les aller-retour sont calculés par trajet, avec la motorisation de chacun des véhicules. Les hypothèses énergie sont indiquées dans le détail administratif et peuvent être remplacées par un montant. Elles ne sont pas des cours de carburant en temps réel.

## Connexion routière

- `ORS_FREE_API_KEY` : itinéraires gratuits existants ; aucun montant de péage fourni.
- **Mode gratuit imposé : HERE n’est pas appelé, même si sa clé existe.** L’adaptateur reste isolé et non utilisé.
- Documentation de l’adaptateur désactivé — `HERE_ROUTING_API_KEY` : connexion optionnelle géocodage + itinéraire rapide + estimation de péages en euros. Clé exclusivement serveur, environnement Preview du projet `helixcar-i89b`. Vérifier le quota et le coût du contrat avant activation ; le péage constitue une transaction supplémentaire. Aucun abonnement n'est créé par ce code.
- Sans HERE, l'IDF peut être entièrement calculée avec ORS. Hors IDF, des péages inconnus restent indisponibles et bloquent la répartition automatique. Un montant vérifié saisi dans les ajustements permet le repli manuel.
- Plateau : estimation non prise en charge ; signalée explicitement.

L'IDF est reconnue d'après tous les codes postaux (restitution comprise). Aucun montant de frais de route n'y est ajouté. Les détails administratifs sont exclus de `publicData`.

Tests : `node tests/t_mission_budget.cjs`, `node tests/t_route_peages.mjs`, `node tests/t_route_gratuite.mjs`, `node tests/t_remuneration_estimation.mjs`.

Limites : tests fournisseurs simulés ; branchement réel et test navigateur authentifié requis avant validation opérationnelle. Le contrôle 30/70 ajouté concerne cet écran ; il ne remplace pas une contrainte comptable en base pour d'autres outils administratifs.
