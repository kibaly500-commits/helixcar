# Calcul gratuit des missions — prototype PR6 (non activé en production)

## Objectif
L'écran administrateur « Préparer les missions » propose « Estimer les kilomètres gratuitement » pour les seuls brouillons de convoyage. Le calcul n'enregistre rien tant que l'administrateur ne choisit pas « Enregistrer le brouillon ». Il n'ajuste pas les rémunérations ni ne publie les missions.

Le serveur Vercel `/api/route-gratuite` utilise Openrouteservice/HeiGIT sur les quotas gratuits, après vérification Supabase `est_admin`. La clé ORS doit rester **uniquement** dans les variables d'environnement Vercel, jamais dans le navigateur ou le dépôt :
- `ORS_FREE_API_KEY` : créer une clé de formule gratuite autorisée selon les conditions HeiGIT. **Ne pas activer de forfait payant ou de dépassement facturable.**
- Toute absence de clé donne `ORS_NON_CONFIGURE`, sans distance inventée.

L'itinéraire retourne distance et durée **sans circulation temps réel**. Le profil `driving-car` avec préférence `fastest` ne garantit **pas** que l'autoroute la plus rapide calculée par Google Maps/Mappy sera choisie. Les péages ne sont **pas** disponibles : aucun montant n'est inventé. Une saisie et validation administrateur restent nécessaires.

Le simulateur indépendant `assets/remuneration-estimation.js` calcule un montant théorique à partir :
- des kilomètres et durées fournis,
- d'un montant de travail proposé,
- d'une garde à **10 €/jour** (données internes),
- d'un prix au litre et d'une consommation estimée,
- du montant des péages vérifié et saisi.
Le résultat total reste indisponible si un trajet n'a pas de péage renseigné, et le simulateur refuse de confirmer une autoroute la plus rapide non validée. Le convoyeur doit seulement voir le **total** et les **frais de route inclus**, jamais la ventilation du montant de garde.

## Éléments volontairement non automatisés
- Calcul des péages français à partir de sources gratuites : source précise, droit de réutilisation et couverture des trajets encore à auditer.
- Mise à jour automatique du prix et des jours de garde dans l'écran : à raccorder une fois les tarifs et la sécurité de projection validés côté serveur.
- Estimations avec trafic en temps réel : non disponibles avec ORS gratuit.

## Tests
`node tests/t_route_gratuite.mjs`
`node tests/t_remuneration_estimation.mjs`
`node tests/lancer.js --sans-sql`

Tests automatisés écrits avec simulations de réponses réseau. Ils ne prouvent pas l'accès réel à HeiGIT, ni les permissions Supabase de production. Ne déployer ni clé ni migration sans recette autorisée. Ne jamais communiquer la clé au navigateur.

## Coûts
Aucune API payante introduite par ce prototype. Hébergement, quotas, conditions d'usage et éventuels changements de l'offre gratuite restent à vérifier. Un quota gratuit n'est **pas** une garantie de coût d'exploitation nul à toute échelle.
