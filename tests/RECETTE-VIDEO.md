# Recette manuelle — vidéo de candidature

Deux parties : ce qui **ne peut pas** être automatisé dans le conteneur
(codecs MP4/MOV absents de son Chromium), et ce qui **ne peut être
vérifié qu'après déploiement** (refus réels de Supabase).

---

## Partie 1 — Formats MP4 et MOV (navigateur réel)

Le Chromium du conteneur renvoie une chaîne vide pour
`canPlayType('video/mp4; codecs="avc1…")` et `video/quicktime` : il ne
possède pas ces codecs. La lecture de **durée** n'y est donc éprouvée
qu'en WebM. Les points ci-dessous doivent être passés à la main.

À faire sur **4 combinaisons** : Chrome ordinateur, Safari ordinateur,
Chrome Android, Safari iPhone.

| # | Étape | Attendu |
|---|---|---|
| 1 | Formulaire partenaire, cocher **Nettoyage** seul | Aucune zone vidéo affichée |
| 2 | Cocher **Convoyage** | Zone vidéo affichée, « **1 minute maximum** » |
| 3 | Cocher aussi **Renfort** | « **2 minutes maximum** », toujours **une seule** zone |
| 4 | « Enregistrer une vidéo » sur téléphone | L'appareil photo s'ouvre |
| 5 | Enregistrer ~20 s puis valider | Nom, taille et **durée** affichés, « Vidéo prête à être envoyée » |
| 6 | « Choisir un fichier » → **MP4** de ~30 s | Accepté, durée correcte affichée |
| 7 | Idem avec un **MOV** (iPhone) de ~30 s | Accepté, durée correcte affichée |
| 8 | Idem avec un **WebM** de ~30 s | Accepté, durée correcte affichée |
| 9 | MP4 de **1 min 30** avec Convoyage seul | Refusé : « Vidéo trop longue… Remplacez-la » |
| 10 | Cocher **Renfort** sans rien changer d'autre | La même vidéo **redevient valide** |
| 11 | Décocher **Renfort** (Convoyage reste) | Elle **repasse** à « à remplacer », **Continuer** rebloqué |
| 12 | MP4 de **2 min 30** | Refusé même avec Renfort |
| 13 | Fichier **.avi** ou **.mkv** | « Format non pris en charge » |
| 14 | Fichier vidéo **> 300 Mo** | « Fichier trop volumineux » |
| 14b | Vidéo réelle de 2 min (~214 Mo) | **acceptée** — c'est le cas qui échouait avec l'ancienne limite |
| 15 | « Remplacer » puis choisir une autre vidéo | La nouvelle remplace l'ancienne dans l'écran |
| 16 | « Supprimer » | Retour aux deux boutons, **Continuer** rebloqué |
| 17 | Soumettre la candidature | Barre de progression, puis « Vidéo envoyée » |
| 18 | Couper le réseau pendant l'envoi | Message d'interruption, candidature **non finalisée**, réessai possible |
| 19 | **Lot V01** — cas réel : MOV iPhone de **1 min 59 s / 214,6 Mo**, métier Renfort | Accepté, envoyé, **« Vidéo envoyée »**, candidature visible dans le Dashboard avec « Voir la vidéo », puis connexion à l'espace partenaire possible après création du compte (la validation métier reste une décision administrateur) |
| 20 | **Lot V01** — fichier `.txt` renommé en `.mp4` | Refusé à la confirmation : « n'est pas une vidéo MP4, MOV ou WebM lisible », candidature **non finalisée** |
| 21 | **Lot V01** — couper le réseau **juste après** la barre à 100 % puis relancer | La relance répond immédiatement « Vidéo envoyée » sans renvoyer le fichier (confirmation idempotente) |
| 22 | **Lot V01** — Dashboard, candidature dont l'envoi a été abandonné | Badge « Envoi en cours, non finalisé », jamais « Manquante » ni « Voir la vidéo » |

> Point 5 particulièrement important sur **Android** : les vidéos issues
> d'un enregistrement direct n'indiquent parfois pas leur durée dans leur
> en-tête. Le code contient un rattrapage pour cela ; ce test le valide
> en conditions réelles.

---

## Partie 2 — Vérifications de sécurité après déploiement

À exécuter **une fois** `migrations/03` appliquée et la fonction
`candidature-video` déployée. Aucune n'a pu être exécutée ici : elles
mettent en jeu les refus réels de Supabase.

### Prérequis
- 2 candidatures de test **A** et **B**, chacune avec une vidéo.
- 1 compte partenaire rattaché à **A** (`convoyeurs.auth_user_id`).
- 1 compte **administrateur** actif dans `public.admins`.
- 1 compte authentifié **non administrateur et non propriétaire**.

### Contrôles

| # | Test | Attendu |
|---|---|---|
| 1 | Envoi anonyme direct : `POST /storage/v1/object/candidatures-videos/x.webm` avec la clé anon | **403** — aucune politique d'insertion pour `anon` |
| 2 | Appeler `candidature-video` action `autoriser` **sans jeton ni session** | **401 UNAUTHORIZED** |
| 3 | Idem avec un jeton inventé | **403 FORBIDDEN** |
| 4 | Appeler `autoriser` avec le jeton de **A** en passant `chemin` visant le dossier de **B** | Chemin renvoyé **dans le dossier de A**, jamais celui de B |
| 5 | Réutiliser un jeton déjà confirmé | **403 FORBIDDEN** (usage unique) |
| 6 | Jeton d'une candidature de plus de 2 h | **403 EXPIRED** |
| 7 | Session de **A** : `select` sur l'objet de **B** dans `storage.objects` | **0 ligne** |
| 8 | Session de **A** : `createSignedUrl` sur le chemin de **B** | **Erreur**, aucune URL |
| 9 | Session de **A** : `remove` / `update` sur l'objet de **B** | **Refusé** |
| 10 | Session de **A** : `createSignedUrl` sur son **propre** objet | **OK** |
| 11 | Compte authentifié **non admin, non propriétaire** : `createSignedUrl` | **Refusé** |
| 12 | Compte **administrateur** : « Voir la vidéo » dans le Dashboard | Lecture OK |
| 13 | Copier l'URL signée, attendre **> 5 min**, la rouvrir | **Expirée**, plus aucune lecture |
| 14 | Ouvrir `…/object/public/candidatures-videos/<chemin>` | **Erreur** — le bucket est privé |
| 15 | Remplacer la vidéo de **A** depuis son espace, puis lister `candidatures/<id A>/` | **Un seul** fichier : aucun orphelin |
| 16 | Vérifier en base | `video_chemin`, `video_mime`, `video_taille_octets` et `video_envoyee_le` renseignés **ensemble**, **aucune URL** stockée ; `video_envoi_chemin` vidé ; `video_upload_jeton_consomme_le` renseigné après confirmation (l'empreinte du jeton est conservée pour rendre la confirmation idempotente, mais un jeton consommé n'autorise plus aucune écriture — contrôle 5) |
| 17 | Inspecter le JavaScript servi au navigateur | Aucune clé `service_role` ; seule la clé `anon` est présente |

### Commandes utiles

```sql
-- 7 : depuis la session du partenaire A
select name from storage.objects
 where bucket_id = 'candidatures-videos';       -- ne doit montrer que ses propres objets

-- 15 : orphelins éventuels
select o.name, o.created_at
  from storage.objects o
 where o.bucket_id = 'candidatures-videos'
   and not exists (select 1 from public.convoyeurs c where c.video_chemin = o.name);

-- 16 : aucune URL en base, quatre colonnes finales cohérentes, envoi en cours vidé
select id, video_chemin, video_mime, video_taille_octets, video_envoyee_le,
       video_envoi_chemin, video_upload_jeton_consomme_le
  from public.convoyeurs
 where video_chemin is not null;

-- 16 bis : envois autorisés jamais finalisés (à réconcilier après 24 h)
select id, video_envoi_chemin, video_envoi_commence_le
  from public.convoyeurs
 where video_envoi_chemin is not null
   and video_envoi_commence_le < now() - interval '24 hours';
```

```bash
# 1 : l'envoi anonyme direct doit être refusé
curl -i -X POST \
  "$SUPABASE_URL/storage/v1/object/candidatures-videos/test-anonyme.webm" \
  -H "apikey: $CLE_ANON" -H "Authorization: Bearer $CLE_ANON" \
  -H "Content-Type: video/webm" --data-binary @petite.webm
# attendu : 403
```
