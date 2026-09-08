// VIDÉO DE CANDIDATURE PARTENAIRE
// Fichiers WebM RÉELS (générés par ffmpeg), décodés par le navigateur.
const L = require('./lib.js');
const path = require('path');
const M = path.resolve(__dirname, 'medias');

const V30 = path.join(M, 'video_30s.webm');
const V90 = path.join(M, 'video_90s.webm');
const V150 = path.join(M, 'video_150s.webm');
const AVI = path.join(M, 'document.avi');
const MP4_FACTICE = path.join(M, 'factice.mp4');

async function ouvrirPartenaire(page) {
  await page.evaluate(() => { try { openModal('convoyeur'); } catch (e) {} });
  await page.waitForTimeout(60);
}
async function activites(page, liste) {
  await page.evaluate(ls => {
    ['convoyage', 'nettoyage', 'renfort'].forEach(v => {
      const el = document.getElementById('conv-act-' + v);
      if (el) el.checked = ls.indexOf(v) !== -1;
    });
    onChoixActivitesPartenaire();
  }, liste);
  await page.waitForTimeout(80);
}
// Dépose un vrai fichier dans l'input caché (comme le fait le sélecteur natif).
async function deposer(page, fichier, quel) {
  await page.setInputFiles('#conv-video-' + (quel || 'fichier'), fichier);
  await page.waitForTimeout(150);
}
async function attendreEtat(page, etats, msMax) {
  const fin = Date.now() + (msMax || 25000);
  let dernier = '';
  while (Date.now() < fin) {
    dernier = await page.evaluate(() => _convVideoEtat);
    if (etats.indexOf(dernier) !== -1) return dernier;
    await page.waitForTimeout(120);
  }
  return dernier;
}
async function etatVideo(page) {
  return page.evaluate(() => ({
    etat: _convVideoEtat,
    msg: _convVideoMsg,
    duree: _convVideo ? _convVideo.duree : null,
    mime: _convVideo ? _convVideo.mime : null,
    nom: _convVideo ? _convVideo.nom : null,
    requise: _convVideoRequise(),
    max: _convVideoDureeMax(),
    ok: _convVideoOk(),
    groupeVisible: (document.getElementById('conv-video-group') || {}).style.display,
    texteDuree: (document.getElementById('conv-video-duree-txt') || {}).textContent
  }));
}

(async () => {
  const browser = await L.launch();
  let page = await L.newPage(browser);
  await ouvrirPartenaire(page);

  // ── A. Exigence et durée selon les activités ──
  await activites(page, ['nettoyage']);
  let e = await etatVideo(page);
  L.check('A1 : nettoyage seul -> aucune vidéo demandée', e.requise === false && e.max === 0);
  L.check('A2 : nettoyage seul -> bloc vidéo masqué', e.groupeVisible === 'none');
  L.check('A3 : nettoyage seul -> progression non bloquée', e.ok === true);

  await activites(page, ['convoyage']);
  e = await etatVideo(page);
  L.check('A4 : convoyage seul -> vidéo obligatoire', e.requise === true);
  L.check('A5 : convoyage seul -> 1 minute maximum', e.max === 60 && /1 minute maximum/.test(e.texteDuree), e.texteDuree);
  L.check('A6 : convoyage sans vidéo -> progression bloquée', e.ok === false);

  await activites(page, ['renfort']);
  e = await etatVideo(page);
  L.check('A7 : renfort -> 2 minutes maximum', e.max === 120 && /2 minutes maximum/.test(e.texteDuree), e.texteDuree);

  await activites(page, ['convoyage', 'nettoyage', 'renfort']);
  e = await etatVideo(page);
  L.check('A8 : 3 activités -> une seule zone vidéo', e.requise === true && e.max === 120);
  const nbZones = await page.evaluate(() => document.querySelectorAll('#conv-video-group .hc-doc-zone').length);
  L.check('A9 : une seule zone vidéo dans le DOM', nbZones === 1, 'zones=' + nbZones);
  const texteBloc = await page.evaluate(() => (document.getElementById('conv-video-group') || {}).textContent || '');
  L.check('A10 : aucun message interne sur le nombre de vidéos',
    !/une seule vid|plusieurs activit|commune/i.test(texteBloc), texteBloc.slice(0, 160));

  // ── B. Format ──
  await activites(page, ['convoyage']);
  await deposer(page, AVI);
  e = await etatVideo(page);
  L.check('B1 : format .avi refusé', e.etat === 'invalide' && /Format non pris en charge/i.test(e.msg), e.msg);
  L.check('B2 : format refusé -> progression bloquée', e.ok === false);

  const mimes = await page.evaluate(() => ({
    mp4: _convMimeVideo({ name: 'a.mp4', type: 'video/mp4' }),
    mp4SansType: _convMimeVideo({ name: 'a.mp4', type: '' }),
    mov: _convMimeVideo({ name: 'a.mov', type: 'video/quicktime' }),
    movSansType: _convMimeVideo({ name: 'a.mov', type: '' }),
    webm: _convMimeVideo({ name: 'a.webm', type: 'video/webm' }),
    avi: _convMimeVideo({ name: 'a.avi', type: 'video/x-msvideo' }),
    extMp4: _convExtensionVideo('video/mp4'),
    extMov: _convExtensionVideo('video/quicktime'),
    extWebm: _convExtensionVideo('video/webm')
  }));
  L.check('B3 : MP4 accepté (type et extension)', mimes.mp4 === 'video/mp4' && mimes.mp4SansType === 'video/mp4');
  L.check('B4 : MOV accepté (type et extension)', mimes.mov === 'video/quicktime' && mimes.movSansType === 'video/quicktime');
  L.check('B5 : WebM accepté', mimes.webm === 'video/webm');
  L.check('B6 : AVI rejeté', mimes.avi === '');
  L.check('B7 : extensions de stockage correctes',
    mimes.extMp4 === '.mp4' && mimes.extMov === '.mov' && mimes.extWebm === '.webm', JSON.stringify(mimes));

  // ── C. Taille ──
  const gros = await page.evaluate(() => {
    const octets = new Uint8Array(1024);
    const morceaux = [];
    for (let i = 0; i < 51 * 1024; i++) morceaux.push(octets);   // ~51 Mo
    const f = new File(morceaux, 'lourde.mp4', { type: 'video/mp4' });
    const dt = new DataTransfer(); dt.items.add(f);
    const input = document.getElementById('conv-video-fichier');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { taille: f.size };
  });
  await page.waitForTimeout(200);
  e = await etatVideo(page);
  L.check('C1 : fichier > 50 Mo refusé', e.etat === 'invalide' && /trop volumineux/i.test(e.msg), e.msg);
  L.check('C2 : refus taille avant toute lecture', e.duree === null && gros.taille > 50 * 1024 * 1024);

  // ── D. Fichier illisible ──
  await deposer(page, MP4_FACTICE);
  let et = await attendreEtat(page, ['invalide'], 25000);
  e = await etatVideo(page);
  L.check('D1 : fichier .mp4 non décodable refusé', et === 'invalide' && /illisible/i.test(e.msg), e.msg);

  // ── E. Durée réelle, décodée par le navigateur ──
  await activites(page, ['convoyage']);
  await deposer(page, V30);
  et = await attendreEtat(page, ['prete', 'invalide'], 25000);
  e = await etatVideo(page);
  L.check('E1 : WebM 30 s accepté pour le convoyage', et === 'prete', et + ' / ' + e.msg);
  L.check('E2 : durée RÉELLEMENT lue par le navigateur',
    e.duree !== null && Math.abs(e.duree - 30) < 2, 'duree=' + e.duree);
  L.check('E3 : vidéo valide -> progression débloquée', e.ok === true);

  await deposer(page, V90);
  et = await attendreEtat(page, ['prete', 'invalide'], 25000);
  e = await etatVideo(page);
  L.check('E4 : WebM 90 s REFUSÉ pour le convoyage (max 1 min)',
    et === 'invalide' && /trop longue/i.test(e.msg), et + ' / ' + e.msg);
  L.check('E5 : durée dépassée -> progression bloquée', e.ok === false);

  await activites(page, ['renfort']);
  e = await etatVideo(page);
  L.check('E6 : le renfort accepte la même vidéo de 90 s (max 2 min)',
    e.etat === 'prete' && e.ok === true, e.etat + ' / ' + e.msg);

  await deposer(page, V150);
  et = await attendreEtat(page, ['prete', 'invalide'], 30000);
  e = await etatVideo(page);
  L.check('E7 : WebM 150 s refusé même pour le renfort',
    et === 'invalide' && /trop longue/i.test(e.msg), et + ' / ' + e.msg);

  // ── F. Retrait du renfort : la vidéo > 1 min doit être remplacée ──
  await activites(page, ['convoyage', 'renfort']);
  await deposer(page, V90);
  et = await attendreEtat(page, ['prete', 'invalide'], 25000);
  e = await etatVideo(page);
  L.check('F1 : renfort + convoyage -> vidéo de 90 s acceptée', et === 'prete', et + ' / ' + e.msg);

  await activites(page, ['convoyage']);   // le renfort est retiré
  e = await etatVideo(page);
  L.check('F2 : renfort retiré, convoyage gardé -> vidéo de 90 s à remplacer',
    e.etat === 'invalide' && /trop longue/i.test(e.msg), e.etat + ' / ' + e.msg);
  L.check('F3 : progression de nouveau bloquée', e.ok === false);
  L.check('F4 : le fichier n\'est pas supprimé en silence', e.nom !== null);

  await activites(page, ['convoyage', 'renfort']);   // le renfort revient
  e = await etatVideo(page);
  L.check('F5 : renfort remis -> la même vidéo redevient valide',
    e.etat === 'prete' && e.ok === true, e.etat + ' / ' + e.msg);

  // ── G. Remplacement et suppression ──
  await deposer(page, V30);
  await attendreEtat(page, ['prete'], 25000);
  e = await etatVideo(page);
  L.check('G1 : remplacement par une autre vidéo', /30s/.test(e.nom) && e.etat === 'prete', e.nom);

  await page.evaluate(() => convSupprimerVideo());
  await page.waitForTimeout(120);
  e = await etatVideo(page);
  const apresSuppr = await page.evaluate(() => ({
    choixVisible: (document.getElementById('conv-video-choix') || {}).style.display,
    etatVisible: (document.getElementById('conv-video-etat') || {}).style.display,
    inputVide: (document.getElementById('conv-video-fichier') || {}).value === ''
  }));
  L.check('G2 : suppression -> aucun fichier retenu', e.nom === null && e.etat === 'vide');
  L.check('G3 : suppression -> retour aux deux boutons de choix',
    apresSuppr.choixVisible === 'flex' && apresSuppr.etatVisible === 'none', JSON.stringify(apresSuppr));
  L.check('G4 : suppression -> input réellement vidé', apresSuppr.inputVide);
  L.check('G5 : suppression -> progression de nouveau bloquée', e.ok === false);

  // ── H. Deux entrées : enregistrement (téléphone) et fichier ──
  const entrees = await page.evaluate(() => {
    const c = document.getElementById('conv-video-capture');
    const f = document.getElementById('conv-video-fichier');
    return {
      capture: c ? c.getAttribute('capture') : null,
      acceptC: c ? c.getAttribute('accept') : '',
      acceptF: f ? f.getAttribute('accept') : '',
      boutons: document.querySelectorAll('#conv-video-choix .hc-video-btn').length
    };
  });
  L.check('H1 : entrée « enregistrer » présente (capture téléphone)', entrees.capture !== null, JSON.stringify(entrees));
  L.check('H2 : entrée « choisir un fichier » présente', entrees.boutons === 2);
  L.check('H3 : les 3 formats sont proposés aux deux entrées',
    /mp4/.test(entrees.acceptC) && /quicktime/.test(entrees.acceptC) && /webm/.test(entrees.acceptC) &&
    /mp4/.test(entrees.acceptF) && /quicktime/.test(entrees.acceptF) && /webm/.test(entrees.acceptF),
    JSON.stringify(entrees));

  // ── I. Bouton Continuer de l'étape 3 ──
  await activites(page, ['convoyage']);
  await page.evaluate(() => { _formStepState.convoyeur = 3; _renderFormStep('convoyeur'); });
  await page.waitForTimeout(120);
  let btn = await page.evaluate(() => document.getElementById('conv-step-next-btn').disabled);
  L.check('I1 : étape 3, vidéo requise absente -> Continuer bloqué', btn === true);

  await deposer(page, V30);
  await attendreEtat(page, ['prete'], 25000);
  await page.waitForTimeout(120);
  btn = await page.evaluate(() => document.getElementById('conv-step-next-btn').disabled);
  L.check('I2 : vidéo valide -> Continuer débloqué', btn === false);

  await activites(page, ['nettoyage']);
  await page.waitForTimeout(120);
  btn = await page.evaluate(() => document.getElementById('conv-step-next-btn').disabled);
  L.check('I3 : nettoyage seul -> Continuer jamais bloqué par la vidéo', btn === false);

  // La validation au clic reste un garde-fou
  await activites(page, ['convoyage']);
  await page.evaluate(() => convSupprimerVideo());
  await page.waitForTimeout(100);
  const v3 = await page.evaluate(() => {
    const ok = _validateConvStep(3);
    return { ok: ok, err: (document.getElementById('conv-zone-video-err') || {}).textContent || '' };
  });
  L.check('I4 : validation au clic bloque aussi l\'étape 3', v3.ok === false);
  L.check('I5 : message factuel, sans règle interne',
    /vidéo de présentation/i.test(v3.err) && !/une seule|plusieurs activit/i.test(v3.err), v3.err);

  // ── J. Envoi sécurisé : autorisation serveur -> URL signée -> confirmation ──
  // Le navigateur n'a AUCUN droit d'écriture sur le bucket : il demande
  // une autorisation, puis dépose sur l'URL signée que le serveur lui a
  // renvoyée. On intercepte les deux points d'appel pour éprouver
  // réellement l'enchaînement et ses échecs.
  await activites(page, ['convoyage']);
  await deposer(page, V30);
  await attendreEtat(page, ['prete'], 25000);

  const CHEMIN_SERVEUR = 'candidatures/11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webm';
  let appels = [];
  async function armerInterceptions(page, opts) {
    appels = [];
    await page.route('**/functions/v1/candidature-video', async route => {
      const corps = JSON.parse(route.request().postData() || '{}');
      appels.push({ type: 'fonction', action: corps.action, corps: corps });
      if (corps.action === 'autoriser') {
        if (opts.autoriserKo) {
          return route.fulfill({ status: 403, contentType: 'application/json',
            body: JSON.stringify({ ok: false, code: 'FORBIDDEN', message: "Autorisation d'envoi inconnue ou déjà utilisée." }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, chemin: CHEMIN_SERVEUR, token: 'jeton-upload-signe', validite_secondes: 120 }) });
      }
      if (opts.confirmerKo) {
        return route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'ENVOI_INCOMPLET', message: "La vidéo n'a pas été reçue entièrement." }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/storage/v1/object/upload/sign/**', async route => {
      appels.push({ type: 'depot', url: route.request().url(), methode: route.request().method() });
      if (opts.depotCoupe) return route.abort('failed');
      if (opts.depotRefuse) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
    });
  }
  async function desarmer(page) {
    await page.unroute('**/functions/v1/candidature-video');
    await page.unroute('**/storage/v1/object/upload/sign/**');
  }
  async function lancerEnvoi(page) {
    return page.evaluate(async () => {
      _convJetonEnvoi = 'f'.repeat(64);   // jeton généré à la soumission
      return await uploadVideoCandidature();
    });
  }

  await armerInterceptions(page, {});
  let envoi = await lancerEnvoi(page);
  L.check('J1 : envoi réussi de bout en bout', envoi.ok === true, JSON.stringify(envoi));
  const autorisation = appels.find(a => a.action === 'autoriser');
  L.check('J2 : une autorisation est demandée au serveur AVANT tout dépôt',
    !!autorisation && appels.indexOf(autorisation) === 0, JSON.stringify(appels.map(a => a.action || a.type)));
  L.check('J3 : le navigateur ne propose AUCUN chemin de stockage',
    autorisation && !autorisation.corps.chemin && !autorisation.corps.path && !autorisation.corps.name,
    JSON.stringify(autorisation && Object.keys(autorisation.corps)));
  L.check('J4 : le navigateur transmet le jeton, le format, la taille et la durée',
    autorisation && autorisation.corps.jeton && autorisation.corps.mime === 'video/webm'
    && autorisation.corps.taille_octets > 0 && autorisation.corps.duree_secondes > 0,
    JSON.stringify(autorisation && autorisation.corps));
  const depot = appels.find(a => a.type === 'depot');
  L.check('J5 : le dépôt se fait sur l\'URL SIGNÉE, jamais en écriture directe',
    !!depot && /\/object\/upload\/sign\/candidatures-videos\//.test(depot.url), depot && depot.url);
  L.check('J6 : le dépôt utilise EXACTEMENT le chemin renvoyé par le serveur',
    !!depot && depot.url.includes(CHEMIN_SERVEUR), depot && depot.url);
  L.check('J7 : le dépôt porte le jeton d\'envoi signé', !!depot && /token=jeton-upload-signe/.test(depot.url));
  L.check('J8 : une confirmation serveur clôt l\'envoi',
    appels.some(a => a.action === 'confirmer'), JSON.stringify(appels.map(a => a.action || a.type)));
  L.check('J9 : aucune clé Supabase dans l\'URL de dépôt',
    !!depot && !/apikey|eyJ/.test(depot.url), depot && depot.url);
  await desarmer(page);

  await armerInterceptions(page, { autoriserKo: true });
  envoi = await lancerEnvoi(page);
  L.check('J10 : autorisation refusée -> message serveur remonté, aucun dépôt',
    !!envoi.erreur && /déjà utilisée|inconnue/i.test(envoi.erreur)
    && !appels.some(a => a.type === 'depot'), JSON.stringify(envoi));
  await desarmer(page);

  await armerInterceptions(page, { depotCoupe: true });
  envoi = await lancerEnvoi(page);
  L.check('J11 : coupure réseau pendant le dépôt -> erreur, aucune confirmation',
    !!envoi.erreur && /interrompue/i.test(envoi.erreur)
    && !appels.some(a => a.action === 'confirmer'), JSON.stringify(envoi));
  await desarmer(page);

  await armerInterceptions(page, { depotRefuse: true });
  envoi = await lancerEnvoi(page);
  L.check('J12 : dépôt refusé (autorisation expirée) -> message explicite',
    !!envoi.erreur && /expirée/i.test(envoi.erreur), JSON.stringify(envoi));
  await desarmer(page);

  await armerInterceptions(page, { confirmerKo: true });
  envoi = await lancerEnvoi(page);
  L.check('J13 : confirmation refusée -> envoi considéré comme échoué',
    !!envoi.erreur && /reçue entièrement/i.test(envoi.erreur), JSON.stringify(envoi));
  await desarmer(page);

  // ── K. Aucune URL publique nulle part ──
  const fs = require('fs');
  const idx = fs.readFileSync('/home/user/helixcar/index.html', 'utf8');
  const dash = fs.readFileSync('/home/user/helixcar/dashboard.html', 'utf8');
  L.check('K1 : aucune URL publique de bucket vidéo dans index.html',
    !/object\/public\/candidatures-videos/.test(idx));
  L.check('K2 : aucune URL publique de bucket vidéo dans dashboard.html',
    !/object\/public\/candidatures-videos/.test(dash));
  // Une vraie clé privilégiée est un JWT dont la charge porte
  // role=service_role : on décode réellement, plutôt que de chercher le
  // mot (présent uniquement dans des commentaires qui en attestent l'absence).
  function jwtsPrivilegies(src) {
    const trouves = src.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
    return trouves.filter(j => {
      try {
        let p = j.split('.')[1]; p += '='.repeat((4 - p.length % 4) % 4);
        return (JSON.parse(Buffer.from(p, 'base64').toString('utf8')).role || '') !== 'anon';
      } catch (e) { return false; }
    });
  }
  const privilegies = jwtsPrivilegies(idx).concat(jwtsPrivilegies(dash));
  L.check('K3 : aucune clé privilégiée (service_role) exposée dans le navigateur',
    privilegies.length === 0, 'trouvées=' + privilegies.length);
  L.check('K3b : les commentaires du code attestent l\'absence de service_role',
    /aucun service_role/i.test(dash));
  L.check('K4 : la lecture admin passe par une URL signée',
    /createSignedUrl\(/.test(dash) && /candidatures-videos/.test(dash));
  L.check('K5 : aucune vidéo ni lien envoyé par email',
    !/emailjs[^\n]*video/i.test(idx) && !/video[^\n]*emailjs/i.test(idx));

  // ── L. F5 : rien ne survit, la vidéo est redemandée ──
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  await ouvrirPartenaire(page);
  await activites(page, ['convoyage']);
  e = await etatVideo(page);
  L.check('L1 : après F5, aucune vidéo fantôme conservée', e.nom === null && e.etat === 'vide');
  L.check('L2 : après F5, la vidéo est de nouveau exigée', e.requise === true && e.ok === false);

  L.check('Aucune erreur JS', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
