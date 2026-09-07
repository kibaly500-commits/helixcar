# Tests navigateur HelixCar

Tests **réels**, exécutés dans Chromium via Playwright sur les fichiers du
dépôt (`file://`). Ils pilotent le formulaire comme un utilisateur :
clics, saisies, navigation entre étapes, rechargement de page.

## Prérequis

```bash
npm install -g playwright            # ou : npx playwright
npx playwright install chromium      # inutile si un Chromium est déjà présent
```

Le chemin de Chromium est défini dans `lib.js` (constante `EXE`) ; adaptez-le
à votre machine si nécessaire.

## Exécution

```bash
cd tests
for f in t_nettoyage t_contact t_pro t_dates t_devis t_nonreg t_brouillon t_video t_video_admin t_decisions t_client t_infos t_motdepasse; do
  echo "== $f"; node $f.js || echo "ÉCHEC $f"
done

# Sécurité serveur (TypeScript, sans réseau)
node --experimental-strip-types t_video_securite.mjs

# Vérification réelle des politiques RLS (PostgreSQL 16 local, jamais Supabase).
# Requiert les binaires postgresql-16 et les droits root pour « su postgres ».
bash t_rls.sh
```

Voir aussi **`RECETTE-VIDEO.md`** : recette manuelle MP4/MOV sur
navigateur réel, et vérifications de sécurité à passer après
déploiement (refus réels de Supabase, non exécutables ici).

Chaque fichier sort en code 0 si tout passe, 1 sinon.

## Contenu

| Fichier | Couvre |
|---|---|
| `t_nettoyage.js` | Parcours Nettoyage complet, étape 2 → étape 4 → récapitulatif, payload |
| `t_contact.js` | Contact sur place : Moi-même / Une autre personne, nettoyage au changement |
| `t_pro.js` | Trouver un professionnel : catégories, conseillé, compteurs, véhicules, récap, payload |
| `t_dates.js` | Calendriers liés (mois d'ouverture), bornes, horaires même jour / multi-jours |
| `t_devis.js` | Devis PDF des 3 services + non-régression du devis convoyage |
| `t_nonreg.js` | Convoyage, Stockage, compte seul, partenaire, périmètre du diff, textes |
| `t_brouillon.js` | Effacer / OK des rubriques, brouillon écrit puis restauré après F5 |
| `t_video.js` | Vidéo partenaire : exigence et durée selon les activités, formats, taille, durée réelle, remplacement, suppression, envoi et erreurs réseau |
| `t_video_admin.js` | Dashboard : fiche unique, états de la vidéo, lecture par URL signée, nettoyage à la fermeture |
| `t_client.js` | **Espace client** : session réelle, action « Faire une nouvelle demande », ouverture du VRAI formulaire public en mode connecté, profil prérempli, compte et e-mail non redemandés, payload rattaché au compte, récapitulatif, contact sur place, retour arrière, double clic, F5, coupure réseau |
| `t_infos.js` | **Informations à compléter** : onglet client, progression, écran de complétion (rubriques manquantes uniquement), transmission, bloc administrateur (Valider / À corriger avec motif obligatoire), persistance, garde-fous |
| `t_motdepasse.js` | **Réinitialisation du mot de passe** : le lien ne tente plus de connexion, adresse vide ou invalide, message neutre identique pour une adresse connue et inconnue, double clic, limitation d'envoi, coupure réseau, formulaire à deux champs, mots de passe différents, lien expiré ou déjà utilisé, F5 pendant le parcours, ancien mot de passe refusé et nouveau accepté, aucun e-mail EmailJS |
| `t_rls.sh` | **Politiques RLS exécutées pour de vrai** sur un PostgreSQL 16 local jetable : compatibilité de la phase préparatoire avec l'ancien Dashboard, effet du durcissement, partenaire bloqué (fiche visible, zéro mission, auto-déblocage impossible, décisions conservées), déblocage administrateur, idempotence de la chaîne complète |
| `t_decisions.js` | **Décisions par activité et blocage partenaire** : indépendance des activités, six transitions, confirmation explicite et annulation sans écriture, historique complet, persistance après F5, blocage réellement enregistré, refus d'autorisation, invalidation d'une session ouverte, zéro e-mail |
| `t_video_securite.mjs` | **Sécurité** : exécute le vrai code de la fonction serveur `candidature-video` contre un double Supabase (jeton, chemin imposé par le serveur, cloisonnement A/B, contrôles format/taille/durée, usage unique, orphelins) |

Les médias de `tests/medias/` sont de **vrais fichiers WebM** (30 s, 90 s,
150 s) encodés par ffmpeg ; `generer.sh` les régénère.

## Limites connues

- `t_devis.js` exécute réellement `_construirePdfDevis`, mais avec un **stub
  jsPDF instrumenté** : le vrai jsPDF est chargé depuis un CDN, injoignable
  en environnement isolé. Le test vérifie donc le **contenu réellement émis**
  (textes, blocs, absence de données inventées), **pas le rendu visuel**.
  Une relecture visuelle d'un PDF réel reste nécessaire avant mise en ligne.
- **MP4 et MOV ne peuvent pas être décodés par le Chromium de test.**
  `canPlayType('video/mp4; codecs="avc1…")` et `video/quicktime` renvoient
  une chaîne vide : cette build est dépourvue des codecs propriétaires.
  Conséquence : la lecture de **durée** n'est éprouvée de bout en bout
  qu'en **WebM**. Pour MP4 et MOV, `t_video.js` vérifie la couche
  d'acceptation réelle (`_convMimeVideo`, extension de stockage), et le
  refus d'un fichier non décodable. Une vérification manuelle sur un
  navigateur disposant de ces codecs (Chrome/Safari, ordinateur et
  téléphone) reste nécessaire avant mise en ligne.
- L'envoi vers Supabase Storage est éprouvé via l'interception réseau de
  Playwright (succès, refus serveur, coupure) : aucun octet ne part
  réellement vers Supabase.
- `t_decisions.js` exécute le **vrai code du Dashboard** contre un double
  Supabase en mémoire qui **simule** les refus RLS selon le rôle : il prouve
  que l'interface réagit correctement à un refus serveur et n'écrit jamais ce
  qu'elle n'a pas le droit d'écrire. La **preuve côté base** est apportée
  séparément par `t_rls.sh`, qui applique les vrais fichiers de `migrations/`
  sur un PostgreSQL 16 local et observe le comportement effectif.
- `t_rls.sh` reconstitue l'environnement Supabase (rôles `anon` /
  `authenticated`, `auth.uid()`) et un schéma **approximé** : seules les
  colonnes dont dépendent les migrations sont reproduites
  (`tests/pg/00_socle_supabase.sql`). Les **politiques testées sont les
  vraies** — les fichiers de `migrations/` sont appliqués sans modification —
  mais un écart entre ce socle et le schéma réel de production reste possible.
  Les contrôles de `migrations/README.md` restent donc à passer sur Supabase
  après application.
- `t_rls.sh` a besoin des binaires PostgreSQL 16 et des droits root
  (`su postgres`). Il ne se connecte **jamais** à Supabase.
- `t_client.js` et `t_infos.js` exécutent le **vrai code** des deux pages
  contre un double Supabase en mémoire. Ils prouvent le comportement de
  l'interface (ce qui est envoyé, ce qui ne l'est pas, ce qui est
  redemandé ou non) ; la **preuve côté base** — cloisonnement entre
  clients, impossibilité de s'auto-valider, calcul serveur des rubriques
  requises — est apportée par `t_rls.sh` sur un PostgreSQL réel.
- Les tests n'écrivent jamais dans Supabase : ils s'arrêtent au payload
  construit côté navigateur. Aucune donnée réelle n'est touchée.
- Les données de test sont préfixées `TEST-QA` et utilisent des adresses en
  `.invalid`.
