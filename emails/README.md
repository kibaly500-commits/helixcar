# Mail d’accès au stockage — point de remise renseigné

Le modèle `stockage-acces.mjs` a été préparé à la demande du propriétaire le 20 septembre 2026. Il existe dans le dépôt pour être repris lors d’une prochaine intervention.

**État : envoi automatique branché côté serveur.** La migration `20260920153911_stockage_notifications_et_point_remise.sql` crée une file privée et les déclencheurs ; l’Edge Function `stockage-notifications` traite la file chaque minute. Le modèle seul n’envoie rien. Le parcours de paiement Stripe conserve ses restrictions de recette existantes.

Adresse fournie par le propriétaire le 20 septembre 2026 : **Point de remise HelixCar — ALDI, 12 rue de l’Université, 93160 Noisy-le-Grand**. C’est le rendez-vous de dépôt/récupération, pas le parking de stockage. Elle est utilisée par défaut par le modèle.

Restriction expressément précisée par le propriétaire : aucune adresse dans le formulaire public, le devis ou les récapitulatifs avant acceptation et paiement. Côté client, le dashboard affiche le point de remise seulement pour une demande avec stockage dont le devis est accepté ET payé. Côté convoyeur, la fonction `point_remise_mission` contrôle l’affectation avant de fournir l’adresse à la fiche et à la confirmation. Les opportunités ouvertes ne reçoivent aucune adresse.

## Cas couverts

- Le client dépose lui-même son véhicule avant le stockage : adresse et rendez-vous de dépôt.
- Le client récupère lui-même son véhicule après le stockage : adresse et rendez-vous de récupération.
- Le client effectue les deux : un seul mail avec les deux rendez-vous.
- HelixCar assure les deux trajets : ce mail ne s’applique pas.

Le déclenchement attend **acceptation ET paiement**, quel que soit leur ordre, avec un envoi unique par demande. Il ne part pas à la simple création de demande ou à l’envoi du devis. Aucun ancien dossier n’est ajouté rétroactivement au déploiement.

## Exploitation et reprise

- Source du modèle : `supabase/functions/_shared/stockage-acces.mjs`, réexportée depuis `emails/stockage-acces.mjs`.
- Référence, dates et heures viennent du dossier ; aucune conversion UTC des horaires civils.
- Une contrainte unique sur le dossier, un verrou de traitement et une clé Resend stable empêchent les doublons. Corps figé avant l’appel fournisseur.
- Échec temporaire : nouvelle tentative après cinq minutes. Après 23 heures depuis le premier essai, `RECONCILIATION_REQUIRED` impose de rapprocher le résultat Resend avant toute reprise, sans renvoi aveugle.
- Changement d’adresse e-mail, de choix de trajet, annulation ou paiement non confirmé : `DOSSIER_MODIFIE`, pas d’envoi automatique.
- Les messages liés aux paiements de recette sont marqués TEST, sans déplacement à effectuer. Aucun paiement réel n’est activé par ce branchement.
- La fiche mission conserve les destinations client et ajoute le point de remise comme arrivée avant stockage / départ après stockage selon les trajets prévus.

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
