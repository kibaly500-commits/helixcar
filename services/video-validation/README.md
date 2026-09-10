# Vérification privée des vidéos — V01

Code préparé, **non déployé**. L'Edge Function refuse une finalisation si
ce service n'est pas configuré. Aucun succès basé sur une durée déclarée
par le navigateur.

## Fonctionnement

1. `preparer_video_candidature` (migration 114) verrouille la candidature,
   prépare/reprend le même chemin temporaire et laisse les colonnes
   vidéo finales intactes. Auth et activité sont contrôlées par l'Edge.
2. Le navigateur envoie directement vers le bucket privé avec la signature
   serveur. Signature d'écriture Supabase : 2 h ; URL de reprise TUS :
   24 h selon le service. Ces URL ne sont **pas revendiquées à usage unique**.
3. L'Edge copie l'objet vers `candidatures/<id>/verifie/<uuid>`. Ce chemin
   ne reçoit jamais de signature d'écriture navigateur ; les écritures
   directes du propriétaire sont retirées par la migration 114.
4. Le worker télécharge cette copie en flux dans un fichier temporaire
   privé, vérifie conteneur, taille, durée, flux vidéo et décodage complet,
   puis retourne les mesures et SHA-256. Aucun lien signé dans ses logs.
5. `finaliser_video_verifiee` lit ces mesures privées et écrit les quatre
   colonnes finales atomiquement. Il vérifie aussi le chemin temporaire
   encore actif : une ancienne reprise ne peut finaliser la nouvelle.

Un objet signé encore modifiable côté source ne peut plus remplacer la
copie finale vérifiée. Une reprise de confirmation réutilise la copie et
les mesures. La connexion du candidat ne le valide pas professionnellement.

## Limites conservées et effectivement testées

- Maximum existant : **314 572 800 octets**, soit 300 × 1024 × 1024.
  Ne pas le diminuer pour faire passer un test.
- Renfort/Technicien : 120 s ; Convoyage seul : 60 s ; Nettoyage seul :
  aucune vidéo attendue selon la règle déjà versionnée. Cette distinction
  doit être confrontée à la configuration métier déployée, non inspectée.
- MP4, QuickTime MOV (marque `qt`), WebM (DocType EBML `webm`). Un MKV
  renommé WebM et un MOV déclaré MP4 sont refusés.
- Décodage réel `ffprobe` + `ffmpeg`, un flux vidéo, au moins une image.
  Codecs validés localement : H.264, VP8 et rawvideo. HEVC et les codecs
  des appareils physiques restent à mesurer dans l'environnement cible.
- Worker : une vérification simultanée par instance, 250 s de budget,
  fichiers supprimés en fin d'opération. Un timeout est réessayable et
  ne finalise rien. Les performances d'un iPhone réel ou d'un hébergeur
  de recette ne sont pas prouvées par les tests Linux.

## Déploiement Preview sans secret partagé

`api/video-validation.mjs` embarque ce worker dans Vercel avec les binaires
FFmpeg/FFprobe épinglés. L'Edge crée un jeton aléatoire, n'en stocke que le
SHA-256 et appelle le worker de la même origine que le formulaire. Le worker
échange ce jeton une seule fois auprès de l'Edge contre une URL de lecture
signée trois minutes. Il ne possède aucune clé Supabase privée.

Les variables ci-dessous restent prises en charge pour un worker privé séparé,
mais ne sont plus nécessaires au parcours Preview Vercel.

## Configuration d'un worker privé séparé

Exécution : Node 24.19.0 et binaires `ffmpeg`, `ffprobe` disponibles.
Commande du service : `node services/video-validation/serveur.mjs`.
Exposer `/verifier` **uniquement derrière HTTPS et authentification privée**.
Prévoir au moins 1 Go d'espace temporaire pour deux fichiers proches de
la limite ; quotas de mémoire/CPU et arrêt de processus à vérifier sur
l'hébergeur retenu. Le choix/l'activation d'hébergement restent à autoriser.

Variables, à configurer dans les gestionnaires de secrets habituels :

| Composant | Variable | Usage |
|---|---|---|
| Worker | `SUPABASE_URL` | Une seule origine de lecture privée autorisée ; valeur HelixCar intégrée pour la Preview |
| Worker et Edge | `HELIXCAR_VIDEO_VALIDATION_SECRET` | Secret serveur partagé, au moins 32 caractères ; jamais côté client |
| Edge | `HELIXCAR_VIDEO_VALIDATION_URL` | URL HTTPS exacte terminant par `/verifier` |
| Worker | `PORT` | Port interne, 8080 par défaut |

Le worker ne reçoit aucune clé `service_role`. Il accepte uniquement des
URLs signées de son origine Supabase, du bucket attendu et de la copie
`verifie` de la candidature ; aucun suivi de redirection HTTP.

## Nettoyage / réconciliation

Action `reconcilier` de `candidature-video`, **JWT d'administrateur actif
vérifié**, aucun droit avec un simple jeton d'upload :

- `{ "action": "reconcilier" }` : inventaire sans suppression ;
- `{ "action": "reconcilier", "appliquer": true }` : nettoyage des
  temporaires admissibles, après revue de l'inventaire en recette ;
- répéter avec `apres: prochain_id` jusqu'à curseur nul (100 dossiers/page).

Seules les candidatures finalisées depuis plus de 25 h, sans upload actif,
sont traitées. L'objet final, tout historique vérifié et les fichiers
récents sont conservés. Les objets sont listés avant suppression afin de
ne pas en sauter lors de la pagination. Une erreur est comptée et renvoyée,
sans prétendre que le nettoyage a réussi.

**Limite explicite :** les candidatures abandonnées mais non finalisées
sont conservées. Leur purge exige un état d'abandon/revocation fiable et
une durée de conservation approuvée ; ne pas supprimer un upload actif
sur la seule base de son ancienneté. V01-007 reste partiellement couvert.
Aucune planification ni suppression distante réalisée pendant cette reprise.

## Vérification et reprise

`node tests/t_video_securite.mjs` utilise un double Supabase ;
`node tests/t_video_reconciliation.mjs` vérifie la conservation/suppression
avec Storage simulé ; `HC_VIDEO_GRANDE=1 node tests/t_video_mesures.mjs`
décode de vrais médias locaux, dont un MOV de 119 s et 224 826 486 octets.
La présence dans le bucket, la RLS réelle, le Dashboard et la connexion
partenaire exigent ensuite la recette isolée T05–T09.

Appliquer 113 puis 114 uniquement après comparaison du schéma déployé et
tests PostgreSQL. Déployer l'Edge et le worker coordonnés, sur autorisation
séparée. Ne pas revenir à l'ancien RPC de finalisation sans mesures en cas
d'échec : conserver les fichiers et afficher la reprise indisponible.

Sources techniques consultées le 10 septembre 2026 :
[signatures Supabase](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl),
[reprise TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).
