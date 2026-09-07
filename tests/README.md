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
for f in t_nettoyage t_contact t_pro t_dates t_devis t_nonreg t_brouillon; do
  echo "== $f"; node $f.js || echo "ÉCHEC $f"
done
```

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
- Les tests n'écrivent jamais dans Supabase : ils s'arrêtent au payload
  construit côté navigateur. Aucune donnée réelle n'est touchée.
- Les données de test sont préfixées `TEST-QA` et utilisent des adresses en
  `.invalid`.
