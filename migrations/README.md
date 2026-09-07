# Migrations SQL HelixCar — lot « nouveaux services & partenaires »

> **Aucune de ces migrations n'a été exécutée.** Elles sont fournies pour
> application manuelle par HelixCar, dans le SQL Editor Supabase.
> Aucun secret ne figure dans ce dossier.

## Ordre d'application

Appliquer **dans l'ordre des préfixes**, un fichier à la fois, en
vérifiant qu'il se termine sans erreur avant de passer au suivant.

| Ordre | Fichier | Objet | Requis pour |
|---|---|---|---|
| 1 | `00_helpers.sql` | `est_admin()`, `est_proprietaire_convoyeur()` | tous les autres |
| 2 | `01_professionnel_details.sql` | `clients.professionnel_details` + index | service « Trouver un professionnel » |
| 3 | `02_contact_sur_place.sql` | garde-fous + vue de lecture | contact sur place |
| 4 | `03_videos_candidature.sql` | métadonnées vidéo + bucket privé + policies Storage | vidéos partenaires |
| 5 | `04_decisions_activites.sql` | décisions par activité + historique | décisions multi-activités |
| 6 | `05_blocage_partenaire.sql` | blocage réel + RLS `convoyeurs` | blocage partenaire |
| 7 | `06_informations_manquantes.sql` | `clients.auth_user_id` + informations à compléter | espace client |

Toutes les instructions sont **idempotentes** (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `DROP POLICY IF EXISTS`) : les rejouer ne duplique
rien.

## Ce qui est indispensable *maintenant*

Seul **`01_professionnel_details.sql`** est nécessaire au code livré dans
cette Pull Request : sans lui, l'enregistrement d'une demande
« Trouver un professionnel automobile » échouera (colonne absente).
`02` est fortement recommandé dans la foulée (garde-fous du contact sur
place, déjà écrit par le formulaire).

Les fichiers `03` à `06` préparent la suite du lot ; leur interface
utilisateur n'est **pas** livrée dans cette Pull Request (voir la section
« Ce qui n'est pas fait » de la description de la PR).

## Réglages manuels Supabase (hors SQL)

1. **Storage → `candidatures-videos`** : vérifier que le bucket apparaît
   bien comme **Private**. C'est le point de sécurité central des vidéos.
2. **Aucune clé `service_role` côté navigateur.** La lecture d'une vidéo
   passe par une **URL signée temporaire** (`createSignedUrl`, 60–300 s),
   générée depuis une session authentifiée, après le contrôle
   d'autorisation assuré par les policies.
3. **Conservation des vidéos** : définir une durée (par exemple 12 mois
   après refus ou inactivité) et la mentionner dans la politique de
   confidentialité **avant** toute mise en service.
4. **Rattachement de l'historique client** : le rapprochement des
   demandes existantes à un compte est laissé volontairement non exécuté
   (requête fournie en commentaire dans `06`) — un rapprochement par
   e-mail peut exposer la demande d'un tiers en cas d'adresse réutilisée.

## Vérifications recommandées après application

Après `05_blocage_partenaire.sql`, contrôler que le blocage est **réel**
et pas seulement visuel, depuis la session d'un partenaire de test bloqué :

```sql
select * from convoyeurs;           -- doit renvoyer 0 ligne
select * from convoyeur_decisions;  -- doit renvoyer 0 ligne
update convoyeurs set bloque = false where auth_user_id = auth.uid();
-- doit échouer : insufficient_privilege
```

Le contrôle doit rester vrai après déconnexion / reconnexion et par
navigation directe.

## Stripe

Aucun objet lié au paiement n'est créé : pas de colonne « payé », pas de
webhook, pas de création automatique de mission. L'enchaînement
paiement → complément → mission reste **dormant** et devra être activé
dans un lot ultérieur, uniquement sur confirmation serveur fiable.
