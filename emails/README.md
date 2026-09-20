# Mail d’accès au stockage — point de remise renseigné

Le modèle `stockage-acces.mjs` a été préparé à la demande du propriétaire le 20 septembre 2026. Il existe dans le dépôt pour être repris lors d’une prochaine intervention.

**État : préparé, envoi automatique désactivé.** Aucun déclencheur, webhook ou service d’envoi existant n’a été modifié. Aucun mail n’est envoyé par ce module.

Adresse fournie par le propriétaire le 20 septembre 2026 : **Point de remise HelixCar — ALDI, 12 rue de l’Université, 93160 Noisy-le-Grand**. C’est le rendez-vous de dépôt/récupération, pas le parking de stockage. Elle est utilisée par défaut par le modèle.

Restriction expressément précisée par le propriétaire : aucune adresse dans le formulaire public, le devis ou les récapitulatifs avant acceptation et paiement. Côté client, le dashboard affiche le point de remise seulement pour une demande avec stockage dont le devis est accepté ET payé. Côté convoyeur, la communication doit attendre sa sélection ; aucun ajout n’est fait ici aux opportunités ouvertes ni aux écrans partenaire. Cette restriction doit être conservée lors du futur branchement des mails.

## Cas couverts

- Le client dépose lui-même son véhicule avant le stockage : adresse et rendez-vous de dépôt.
- Le client récupère lui-même son véhicule après le stockage : adresse et rendez-vous de récupération.
- Le client effectue les deux : un seul mail avec les deux rendez-vous.
- HelixCar assure les deux trajets : ce mail ne s’applique pas.

Le texte confirme l’acceptation de la demande et le paiement enregistré. Le futur déclenchement devra donc attendre **ces deux conditions**, quel que soit leur ordre, avec un envoi unique par demande. Il ne doit pas partir à la simple création de demande ou à l’envoi du devis.

## À compléter avant activation

1. L’adresse du point de remise est renseignée. Le modèle refuse toujours une adresse explicitement vide. Conserver la distinction entre point de remise et lieu de stockage.
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

Point de remise HelixCar : **ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand**

Il s’agit du point de rendez-vous pour la remise de votre véhicule. Votre véhicule sera stocké sur un site distinct.

Cette adresse concerne uniquement le dépôt et/ou la récupération que vous effectuez vous-même, selon les choix de votre demande.

Pour toute question ou modification de rendez-vous, contactez notre équipe.

L’équipe HelixCar
