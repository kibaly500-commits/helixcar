# Mail d’accès au stockage — modèle existant, en attente d’adresse

Le modèle `stockage-acces.mjs` a été préparé à la demande du propriétaire le 20 septembre 2026. Il existe dans le dépôt pour être repris lors d’une prochaine intervention.

**État : préparé, envoi automatique désactivé.** Aucun déclencheur, webhook ou service d’envoi existant n’a été modifié. Aucun mail n’est envoyé par ce module.

## Cas couverts

- Le client dépose lui-même son véhicule avant le stockage : adresse et rendez-vous de dépôt.
- Le client récupère lui-même son véhicule après le stockage : adresse et rendez-vous de récupération.
- Le client effectue les deux : un seul mail avec les deux rendez-vous.
- HelixCar assure les deux trajets : ce mail ne s’applique pas.

Le texte confirme l’acceptation de la demande et le paiement enregistré. Le futur déclenchement devra donc attendre **ces deux conditions**, quel que soit leur ordre, avec un envoi unique par demande. Il ne doit pas partir à la simple création de demande ou à l’envoi du devis.

## À compléter avant activation

1. Le propriétaire fournit et valide l’adresse exacte. Ne pas inventer d’adresse ni envoyer un placeholder. Le modèle refuse une adresse vide.
2. Relier les choix réels de dépôt/récupération, la référence et les dates/heures du dossier au modèle (dates affichées en français, horaires locaux, sans décalage de fuseau).
3. Brancher l’envoi côté serveur sur les événements métier existants, avec vérification des deux conditions et protection persistante contre les doublons/reprises.
4. Valider le contenu final avec le propriétaire avant activation. Ne pas activer uniquement en changeant la constante : elle documente l’état, ce module n’effectue aucun envoi.

## Texte préparé

Objet : **HelixCar — Adresse et rendez-vous de stockage — [référence]**

Bonjour,

Votre demande [référence] a été acceptée et votre paiement a bien été enregistré.

Voici les informations pratiques pour votre stockage automobile.

Dépôt de votre véhicule par vos soins : le [date choisie] à [heure choisie]. *(Si concerné.)*

Récupération de votre véhicule par vos soins après stockage : le [date choisie] à [heure choisie]. *(Si concerné.)*

Adresse du lieu de stockage : **[adresse exacte à fournir par le propriétaire]**

Cette adresse concerne uniquement le dépôt et/ou la récupération que vous effectuez vous-même, selon les choix de votre demande.

Pour toute question ou modification de rendez-vous, contactez notre équipe.

L’équipe HelixCar
