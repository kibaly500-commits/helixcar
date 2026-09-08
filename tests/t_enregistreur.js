// ENREGISTREUR VIDÉO ET LIMITE 300 Mo
// Chromium est lancé avec une caméra factice : getUserMedia et
// MediaRecorder fonctionnent réellement, l'enregistrement est vrai.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}

(async () => {
  const navigateur = await lancerNavigateur({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const contexte = await navigateur.newContext({ permissions: ['camera', 'microphone'] });
  const page = await contexte.newPage();
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  page.on('dialog', d => d.accept());

  await page.goto(urlFichier('index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => { try { openModal('convoyeur'); } catch (e) {} });
  await page.waitForTimeout(200);

  // ── A. DEUX ACTIONS DISTINCTES ──
  const boutons = await page.evaluate(() => {
    const c = document.getElementById('conv-video-btn-capture');
    const f = document.getElementById('conv-video-btn-fichier');
    return {
      capture: c ? { texte: c.textContent.trim(), action: c.getAttribute('onclick') } : null,
      fichier: f ? { texte: f.textContent.trim(), action: f.getAttribute('onclick') } : null
    };
  });
  check('A1 : « Enregistrer une vidéo » n\'ouvre PLUS le sélecteur de fichiers',
    boutons.capture && /convOuvrirEnregistreur/.test(boutons.capture.action)
    && !/convOuvrirSelecteurVideo/.test(boutons.capture.action), JSON.stringify(boutons.capture));
  check('A2 : « Choisir une vidéo existante » ouvre bien le sélecteur',
    boutons.fichier && /Choisir une vidéo existante/.test(boutons.fichier.texte)
    && /convOuvrirSelecteurVideo/.test(boutons.fichier.action), JSON.stringify(boutons.fichier));

  // ── B. CAPACITÉS RÉELLES DU NAVIGATEUR ──
  const capacites = await page.evaluate(() => ({
    possible: _convEnregistrementPossible(),
    format: _convFormatEnregistrement()
  }));
  check('B1 : le navigateur est reconnu comme capable d\'enregistrer',
    capacites.possible === true, JSON.stringify(capacites));
  check('B2 : un format MP4 ou WebM est retenu',
    capacites.format && ['mp4', 'webm'].includes(capacites.format.ext), JSON.stringify(capacites.format));

  // ── C. OUVERTURE DE LA CAMÉRA ──
  await page.evaluate(() => convOuvrirEnregistreur());
  await page.waitForTimeout(900);
  const ouvert = await page.evaluate(() => ({
    panneau: (document.getElementById('conv-enregistreur') || {}).style.display,
    fluxActif: !!(_convEnr.flux && _convEnr.flux.getTracks().length),
    apercuSource: !!(document.getElementById('conv-enr-apercu') || {}).srcObject,
    demarrerVisible: (document.getElementById('conv-enr-demarrer') || {}).style.display,
    message: (document.getElementById('conv-enr-message') || {}).textContent || ''
  }));
  check('C1 : le panneau d\'enregistrement s\'ouvre', ouvert.panneau === 'block', JSON.stringify(ouvert));
  check('C2 : la caméra est réellement ouverte', ouvert.fluxActif === true, JSON.stringify(ouvert));
  check('C3 : un aperçu de la caméra est affiché', ouvert.apercuSource === true);
  check('C4 : le bouton Démarrer est proposé', ouvert.demarrerVisible !== 'none', ouvert.demarrerVisible);

  // ── D. ENREGISTREMENT RÉEL ──
  await page.evaluate(() => convDemarrerEnregistrement());
  await page.waitForTimeout(2600);
  const pendant = await page.evaluate(() => ({
    etat: _convEnr.recorder && _convEnr.recorder.state,
    arreterVisible: (document.getElementById('conv-enr-arreter') || {}).style.display,
    pastille: (document.getElementById('conv-enr-pastille') || {}).style.display,
    chrono: (document.getElementById('conv-enr-chrono') || {}).textContent
  }));
  check('D1 : l\'enregistrement est réellement en cours', pendant.etat === 'recording', JSON.stringify(pendant));
  check('D2 : Arrêter est proposé pendant l\'enregistrement', pendant.arreterVisible !== 'none');
  check('D3 : un chronomètre visible court', pendant.pastille === 'block' && /0:0[1-9]/.test(pendant.chrono), pendant.chrono);

  await page.evaluate(() => convArreterEnregistrement());
  await page.waitForTimeout(900);
  const apres = await page.evaluate(() => ({
    taille: _convEnr.blob ? _convEnr.blob.size : 0,
    type: _convEnr.blob ? _convEnr.blob.type : '',
    relecture: !!(document.getElementById('conv-enr-apercu') || {}).controls,
    validerVisible: (document.getElementById('conv-enr-valider') || {}).style.display,
    recommencerVisible: (document.getElementById('conv-enr-recommencer') || {}).style.display
  }));
  check('D4 : une vidéo réelle a été produite', apres.taille > 0, 'octets=' + apres.taille);
  check('D5 : au format MP4 ou WebM', /video\/(mp4|webm)/.test(apres.type), apres.type);
  check('D6 : relecture possible avant validation', apres.relecture === true);
  check('D7 : Recommencer et Utiliser cette vidéo sont proposés',
    apres.validerVisible !== 'none' && apres.recommencerVisible !== 'none', JSON.stringify(apres));

  // ── E. LA VIDÉO ENREGISTRÉE SUIT LE PARCOURS NORMAL ──
  await page.evaluate(() => convValiderEnregistrement());
  await page.waitForTimeout(1200);
  const integre = await page.evaluate(() => ({
    video: _convVideo ? { nom: _convVideo.nom, mime: _convVideo.mime, taille: _convVideo.taille } : null,
    etat: _convVideoEtat,
    panneau: (document.getElementById('conv-enregistreur') || {}).style.display,
    fluxLibere: !_convEnr.flux
  }));
  check('E1 : la vidéo enregistrée devient la vidéo de la candidature',
    !!integre.video && integre.video.taille > 0, JSON.stringify(integre));
  check('E2 : elle passe par la même validation que un fichier choisi',
    !!integre.video && /video\/(mp4|webm)/.test(integre.video.mime), JSON.stringify(integre.video));
  check('E3 : le panneau se referme et la caméra est libérée',
    integre.panneau === 'none' && integre.fluxLibere === true, JSON.stringify(integre));

  // ── F. LIMITES ET REPLIS ──
  const limites = await page.evaluate(() => ({
    max: CONV_VIDEO_TAILLE_MAX,
    dureeMax: CONV_ENR_DUREE_MAX_S,
    mimes: CONV_VIDEO_MIMES
  }));
  check('F1 : la limite de taille est bien de 300 Mo',
    limites.max === 300 * 1024 * 1024, String(limites.max));
  check('F2 : l\'arrêt automatique est fixé à deux minutes', limites.dureeMax === 120, String(limites.dureeMax));
  check('F3 : MP4, MOV et WebM restent acceptés',
    ['video/mp4', 'video/quicktime', 'video/webm'].every(m => limites.mimes.includes(m)), JSON.stringify(limites.mimes));

  const repli = await page.evaluate(() => {
    const vrai = window.MediaRecorder;
    window.MediaRecorder = undefined;
    const possible = _convEnregistrementPossible();
    window.MediaRecorder = vrai;
    return possible;
  });
  check('F4 : sans MediaRecorder, l\'enregistrement se sait impossible et bascule en repli',
    repli === false);

  check('F5 : aucune erreur JS', erreursJs.length === 0, erreursJs.join(' | '));

  // ── G. COHÉRENCE DES COUCHES ──
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const fn = fs.readFileSync(fichier('supabase/functions/candidature-video/index.ts'), 'utf8');
  const mig = fs.readFileSync(fichier('migrations/93_bucket_video_300mo.sql'), 'utf8');
  check('G1 : navigateur, fonction serveur et bucket annoncent la même limite',
    /300 \* 1024 \* 1024/.test(idx) && /300 \* 1024 \* 1024/.test(fn) && /314572800/.test(mig));
  // On ne teste que le CODE : la procédure de retour arrière de la
  // migration cite forcément l'ancienne valeur, en commentaire.
  const migCode = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  check('G2 : plus aucune limite à 50 Mo dans ces trois couches',
    !/50 \* 1024 \* 1024/.test(idx) && !/50 \* 1024 \* 1024/.test(fn) && !/52428800/.test(migCode),
    (migCode.match(/.*52428800.*/) || []).join(' | '));
  check('G3 : le bucket reste privé', /public\s*=\s*false/.test(mig) && !/public\s*=\s*true/.test(mig));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  await navigateur.close();
  process.exit(fail ? 1 : 0);
})();
