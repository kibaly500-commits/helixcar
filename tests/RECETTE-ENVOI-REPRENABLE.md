# Envoi vidéo reprenable — étude technique et recette

> Ce document répond à une question précise : **peut-on rendre l'envoi
> d'une vidéo de candidature reprenable, sans rien affaiblir ?**
> La réponse est **oui**, et l'implémentation est en place. Les preuves
> sont ci-dessous, avec leurs sources.

## 1. Le problème

Une vidéo de candidature peut atteindre **300 Mo**. Jusqu'ici, elle
partait en **une seule requête PUT** vers une URL signée. Conséquence :
la moindre coupure — tunnel, changement de Wi-Fi, ascenseur, veille du
téléphone — obligeait à **tout recommencer depuis zéro**. Sur une
connexion mobile, un candidat pouvait ne jamais y arriver.

## 2. La contrainte à respecter

Le dépôt d'une candidature se fait **sans compte**. Il n'existe donc
aucune session utilisateur, aucun `auth.uid()`, au moment de l'envoi. Et
quatre règles ne sont pas négociables :

1. la clé `service_role` ne doit **jamais** atteindre le navigateur ;
2. le bucket `candidatures-videos` doit rester **privé**, sans aucune
   politique ouverte à `anon` ;
3. la vidéo ne doit **pas** transiter par la fonction serveur ;
4. le chemin de destination doit rester **choisi par le serveur**.

## 3. Ce qui a été vérifié, et où

L'étude n'a pas porté sur de la documentation commerciale mais sur le
**code source du serveur de stockage Supabase** (dépôt public
`supabase/storage`) et sur celui de son client (`supabase/storage-js`).

### 3.1 Il existe une route reprenable SIGNÉE

`src/http/routes/tus/index.ts` enregistre deux familles de routes : les
routes authentifiées (`registerJwtAuth`) **et** des routes signées,
montées sous le suffixe `SIGNED_URL_SUFFIX` (`/sign`) avec
`dbSuperUser` — **sans exiger de session utilisateur** :

```ts
// signed routes
fastify.register(
  async (fastify) => {
    fastify.register(dbSuperUser)
    fastify.register(storage)
    fastify.register(authenticatedRoutes, { ..., operation: '_signed' })
  },
  { prefix: SIGNED_URL_SUFFIX }
)
```

### 3.2 Elle accepte EXACTEMENT notre jeton d'envoi

`src/http/routes/tus/lifecycle.ts` :

```ts
if (req.url?.startsWith(`/upload/resumable/sign`)) {
  const signature = req.headers['x-signature']
  if (!signature || typeof signature !== 'string') {
    throw ERRORS.InvalidSignature('Missing x-signature header')
  }
  const payload = await req.upload.storage
    .from(uploadID.bucket)
    .verifyObjectSignature(signature, uploadID.objectName, SIGNED_URL_SCOPE_UPLOAD)
  ...
}
```

Et `src/storage/object.ts` montre que le jeton délivré par
`createSignedUploadUrl` porte précisément ce scope :

```ts
const token = await signJWT(
  { owner, url, upsert: Boolean(options?.upsert), scope: SIGNED_URL_SCOPE_UPLOAD },
  urlSigningKey, expiresIn
)
```

**Conclusion : le jeton que notre fonction serveur délivrait déjà est
accepté par la route reprenable.** Aucune session, aucune clé
privilégiée, aucun droit supplémentaire.

### 3.3 Ce que la signature autorise, et rien de plus

`verifyObjectSignature` compare le jeton à **un nom d'objet précis** et
à un **scope d'écriture**. Une signature ne permet donc pas :

* d'écrire ailleurs que sur ce chemin exact ;
* de **lire** quoi que ce soit ;
* d'agir sur une autre candidature.

Les quatre règles du point 2 restent donc intégralement respectées.

## 4. Ce qui a été implémenté

### Côté serveur — `supabase/functions/candidature-video/index.ts`

| Évolution | Raison |
|---|---|
| Validité de la signature portée de **2 minutes à 30 minutes** | 2 minutes rendaient tout envoi long impossible. Une signature n'autorise toujours qu'un seul chemin, en écriture seule. |
| Nouvelle action **`prolonger`** | Un envoi peut durer plus longtemps qu'une signature. Elle en délivre une fraîche **pour le chemin déjà enregistré**, jamais pour un chemin proposé par le navigateur, et **ne consomme pas** le jeton à usage unique. |
| `autoriser` **réutilise** le chemin d'un envoi en cours | Sans cela, un rechargement de page laisserait un objet partiel orphelin et recommencerait tout. |
| `technicien` ajouté à `dureeMaxPourActivites` | Cohérence avec la sélection multi-métiers. |

### Côté navigateur — `index.html`

Un client **TUS 1.0.0 minimal**, écrit sans dépendance :

* `POST` de création vers `/storage/v1/upload/resumable/sign`, avec
  `x-signature` et les métadonnées `bucketName` / `objectName` ;
* `PATCH` par morceaux de **6 Mo**, avec `Upload-Offset` ;
* `HEAD` pour retrouver l'offset **réel** après une coupure ;
* renouvellement automatique de la signature avant expiration, et
  après un refus 401/403 en cours de route ;
* mémorisation de l'envoi en cours (`localStorage`) pour **reprendre
  après un rechargement de la page** — sans y stocker le moindre secret ;
* **secours automatique** : si la route reprenable n'existe pas ou est
  injoignable, l'envoi repasse par la requête unique d'avant. Aucun
  candidat ne peut être bloqué par cette évolution.

> Aucune bibliothèque n'a été ajoutée : le site charge déjà ses
> dépendances depuis un CDN, et en ajouter une aurait fait dépendre le
> dépôt d'une candidature de la disponibilité de ce CDN.

## 5. Tests réellement exécutés

`tests/t_tus.js` fait tourner le **vrai code d'envoi du site** contre un
**vrai serveur TUS** écrit dans le test, en HTTP, sur la machine de
recette. Les octets partent réellement du navigateur.

| Scénario | Vérifié |
|---|---|
| Envoi complet de 15 Mo | découpé en ≥ 3 morceaux de 6 Mo maximum, tous les octets reçus, progression rapportée |
| Panne en plein envoi | l'envoi aboutit quand même, l'offset réel est redemandé (`HEAD`), **aucun octet déjà reçu n'est renvoyé** |
| Signature expirée avant le premier octet | une signature fraîche est demandée, l'envoi aboutit |
| Rechargement complet de la page | l'envoi **reprend** l'objet existant, n'en crée pas un second, ne renvoie que ce qui manquait |
| Route reprenable absente | le secours en une requête prend le relais et aboutit |
| Sécurité | aucune clé privilégiée dans aucune requête, chemin toujours choisi par le serveur, bucket jamais public, vidéo jamais passée par la fonction serveur |

**35 vérifications, 35 réussies.**

## 6. Recette manuelle, sur le site réel

À faire **après** le déploiement, sur un téléphone :

1. Déposer une candidature Convoyage avec une vidéo de **plus de 50 Mo**.
2. Pendant l'envoi, **activer le mode avion 5 secondes**, puis le couper.
   → L'envoi doit repartir de là où il en était, pas de zéro. La
   progression ne doit **jamais** revenir à 0 %.
3. Pendant l'envoi, **recharger la page**, revenir au formulaire et
   relancer l'envoi de la même vidéo.
   → Le serveur doit reprendre l'objet en cours ; le dossier de la
   candidature ne doit contenir **qu'un seul fichier** à la fin.
4. Vérifier dans Supabase → Storage → `candidatures-videos` :
   * le bucket est toujours **Private** ;
   * `candidatures/<id>/` contient **exactement une** vidéo.
5. Vérifier dans le Dashboard que la vidéo est lisible par l'administrateur.

### Réglage indispensable avant cette recette

Supabase → Storage → Settings → **limite globale de taille de fichier**
à **300 Mo minimum**. La migration `93` règle la limite du *bucket*,
mais la limite *globale* du projet s'applique en plus et n'est pas
accessible en SQL.
