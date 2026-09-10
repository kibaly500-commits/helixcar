// ENVOI VIDÉO REPRENABLE — PROTOCOLE TUS (§4)
// ------------------------------------------------------------------
// Ce fichier fait tourner le VRAI code d'envoi du site contre un VRAI
// serveur TUS écrit ici, en HTTP, sur la machine de test. Les requêtes
// partent réellement du navigateur : en-têtes, découpage, octets
// transmis, reprise après coupure — tout est observé côté serveur.
//
// Aucun octet ne part vers Supabase : XMLHttpRequest est redirigé vers
// le serveur local, et la fonction serveur est simulée par le même
// serveur. C'est la LOGIQUE d'envoi qui est éprouvée, sur le vrai code.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');
const http = require('http');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 220) + ']' : '')); fail++; echecs.push(l); }
}

// ── SERVEUR TUS + FONCTION SERVEUR SIMULÉE ──
const etat = {
  uploads: {},            // id -> { taille, recu, chemin, morceaux: [] }
  signatures: {},         // jeton -> { chemin, expireLe }
  journal: [],            // toutes les requêtes reçues
  couperApres: null,      // octets après lesquels couper la connexion une fois
  coupureFaite: false,
  expirerSignatureApres: null,
  cheminAutorise: null,
  prolongations: 0,
  autorisations: 0,
  confirmations: 0,
};

function nouvelleSignature(chemin, dureeMs) {
  const j = 'sig-' + Math.random().toString(36).slice(2) + '-' + Date.now();
  etat.signatures[j] = { chemin, expireLe: Date.now() + (dureeMs || 30 * 60 * 1000) };
  return j;
}

function signatureValide(jeton, chemin) {
  const s = etat.signatures[jeton];
  if (!s) return false;
  if (Date.now() > s.expireLe) return false;
  return s.chemin === chemin;
}

function corps(req) {
  return new Promise(r => {
    const morceaux = [];
    req.on('data', d => morceaux.push(d));
    req.on('end', () => r(Buffer.concat(morceaux)));
    req.on('error', () => r(Buffer.concat(morceaux)));
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers',
    'Location, Upload-Offset, Upload-Length, Tus-Resumable, Tus-Version');
}

function decoderMetadonnees(entete) {
  const out = {};
  String(entete || '').split(',').forEach(p => {
    const [cle, val] = p.trim().split(' ');
    if (cle) out[cle] = val ? Buffer.from(val, 'base64').toString('utf8') : '';
  });
  return out;
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  etat.journal.push({ methode: req.method, chemin: url.pathname,
                      signature: req.headers['x-signature'] || null,
                      offset: req.headers['upload-offset'] || null,
                      autorisation: req.headers['authorization'] || null });
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Fonction serveur « candidature-video » ──
  if (url.pathname === '/functions/v1/candidature-video') {
    const b = JSON.parse((await corps(req)).toString() || '{}');
    if (b.action === 'autoriser') {
      etat.autorisations++;
      etat.cheminAutorise = etat.cheminAutorise
        || ('candidatures/qa-1/' + Math.random().toString(36).slice(2) + '.mp4');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chemin: etat.cheminAutorise,
        bucket: 'candidatures-videos',
        token: nouvelleSignature(etat.cheminAutorise, etat.expirerSignatureApres),
        validite_secondes: 1800, reprise: false }));
      return;
    }
    if (b.action === 'prolonger') {
      etat.prolongations++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chemin: etat.cheminAutorise,
        bucket: 'candidatures-videos',
        token: nouvelleSignature(etat.cheminAutorise), validite_secondes: 1800 }));
      return;
    }
    if (b.action === 'confirmer') {
      etat.confirmations++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Action inconnue.' }));
    return;
  }

  // ── Route reprenable SIGNÉE ──
  if (url.pathname === '/storage/v1/upload/resumable/sign') {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    const meta = decoderMetadonnees(req.headers['upload-metadata']);
    const sig = req.headers['x-signature'];
    if (!sig || !signatureValide(sig, meta.objectName)) {
      res.writeHead(401, { 'Tus-Resumable': '1.0.0' }); res.end('signature invalide'); return;
    }
    const id = 'up-' + Math.random().toString(36).slice(2);
    etat.uploads[id] = { taille: parseInt(req.headers['upload-length'], 10),
                         recu: 0, chemin: meta.objectName, mime: meta.contentType,
                         bucket: meta.bucketName, morceaux: [] };
    res.writeHead(201, { 'Tus-Resumable': '1.0.0',
                         'Location': 'http://127.0.0.1:' + PORT + '/storage/v1/upload/resumable/sign/' + id });
    res.end();
    return;
  }

  const m = /^\/storage\/v1\/upload\/resumable\/sign\/(up-[a-z0-9]+)$/.exec(url.pathname);
  if (m) {
    const up = etat.uploads[m[1]];
    if (!up) { res.writeHead(404); res.end(); return; }
    const sig = req.headers['x-signature'];

    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(up.recu),
                           'Upload-Length': String(up.taille), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (req.method === 'PATCH') {
      if (!sig || !signatureValide(sig, up.chemin)) {
        res.writeHead(401, { 'Tus-Resumable': '1.0.0' }); res.end('signature expirée'); return;
      }
      const offset = parseInt(req.headers['upload-offset'], 10);
      if (offset !== up.recu) {
        res.writeHead(409, { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(up.recu) });
        res.end(); return;
      }
      // Coupure réseau scriptée : la connexion est fermée brutalement,
      // exactement comme un tunnel ou un changement de réseau.
      const donnees = await corps(req);
      if (etat.couperApres !== null && !etat.coupureFaite && up.recu >= etat.couperApres) {
        etat.coupureFaite = true;
        up.recu += donnees.length;          // le serveur a bien reçu…
        up.morceaux.push(donnees.length);
        res.writeHead(503, { 'Tus-Resumable': '1.0.0' });
        res.end('panne passagère');          // …mais le client croit avoir échoué
        return;
      }
      up.recu += donnees.length;
      up.morceaux.push(donnees.length);
      res.writeHead(204, { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(up.recu) });
      res.end();
      return;
    }
    res.writeHead(405); res.end(); return;
  }

  // Route NON reprenable (secours) : envoi en une seule requête.
  if (url.pathname.startsWith('/storage/v1/object/upload/sign/')) {
    const donnees = await corps(req);
    etat.uploads['secours'] = { taille: donnees.length, recu: donnees.length, morceaux: [donnees.length] };
    res.writeHead(200); res.end('{}');
    return;
  }

  res.writeHead(404); res.end();
});

let PORT = 0;

// Redirige XMLHttpRequest et fetch du VRAI site vers le serveur local.
function redirection(port) {
  return `
    (function () {
      var CIBLE = 'http://127.0.0.1:${port}';
      var PREFIXE = 'https://zsetmqnmmupqbkgqbjbo.supabase.co';
      function reecrire(u) {
        u = String(u);
        return u.indexOf(PREFIXE) === 0 ? CIBLE + u.slice(PREFIXE.length) : u;
      }
      var openReel = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u) {
        window.__xhr = (window.__xhr || 0) + 1;
        return openReel.call(this, m, reecrire(u), true);
      };
      var fetchReel = window.fetch;
      window.fetch = function (u, o) { return fetchReel.call(window, reecrire(u), o); };
      window.__tusPret = true;
    })();
  `;
}

// Construit un faux fichier vidéo de la taille voulue, dans la page.
async function preparerVideo(page, octets) {
  await page.evaluate(n => {
    // La vidéo n'est exigée que pour certaines activités. Celles-ci se
    // déduisent des métiers : on ajoute donc réellement le métier, comme
    // le ferait un candidat.
    if (typeof convAjouterMetier === 'function') convAjouterMetier('convoyage');
    const buf = new Uint8Array(n);
    for (let i = 0; i < n; i++) buf[i] = i % 251;
    const f = new File([buf], 'TEST-QA.mp4', { type: 'video/mp4', lastModified: 1767225600000 });
    _convVideo = { fichier: f, mime: 'video/mp4', taille: f.size, duree: 42, nom: f.name };
    _convJetonEnvoi = 'a'.repeat(64);
    TUS_DELAI_REQUETE_MS = 8000;
    window.__progression = [];
    window.convMajProgressionVideo = function (p) { window.__progression.push(p); };
  }, octets);
}

(async () => {
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  PORT = serveur.address().port;

  const browser = await lancerNavigateur();

  async function nouvellePage() {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p.on('pageerror', e => { p.__errs = p.__errs || []; p.__errs.push(e.message); });
    await p.addInitScript(redirection(PORT));
    await p.goto(urlFichier('index.html'), { waitUntil: 'load' });
    return p;
  }

  // ══ A. ENVOI COMPLET, EN PLUSIEURS MORCEAUX ══
  let page = await nouvellePage();
  const TAILLE = 15 * 1024 * 1024;   // 15 Mo -> au moins 3 morceaux de 6 Mo
  await preparerVideo(page, TAILLE);
  let r = await page.evaluate(() => uploadVideoCandidature());
  const upA = Object.values(etat.uploads).filter(u => u.chemin)[0];

  check('A1 : l\'envoi aboutit', r && r.ok === true, JSON.stringify(r));
  check('A2 : le serveur a reçu TOUS les octets',
    upA && upA.recu === TAILLE, upA && (upA.recu + '/' + TAILLE));
  check('A3 : il a été découpé en plusieurs morceaux',
    upA && upA.morceaux.length >= 3, JSON.stringify(upA && upA.morceaux));
  check('A4 : chaque morceau fait au plus 6 Mo',
    upA && upA.morceaux.every(t => t <= 6 * 1024 * 1024), JSON.stringify(upA && upA.morceaux));
  check('A5 : le protocole annoncé est bien TUS 1.0.0',
    etat.journal.some(j => j.chemin === '/storage/v1/upload/resumable/sign' && j.methode === 'POST'));
  check('A6 : le chemin visé est celui du serveur, jamais un chemin du navigateur',
    upA && upA.chemin === etat.cheminAutorise, upA && upA.chemin);
  check('A7 : le bucket visé est le bucket privé des candidatures',
    upA && upA.bucket === 'candidatures-videos', upA && upA.bucket);
  check('A8 : la confirmation serveur a bien eu lieu', etat.confirmations === 1, String(etat.confirmations));
  const prog = await page.evaluate(() => window.__progression.slice());
  check('A9 : la progression est réellement rapportée au candidat',
    prog.length > 2 && prog[prog.length - 1] === 100, JSON.stringify(prog.slice(-3)));
  check('A10 : AUCUNE requête ne porte de clé privilégiée',
    etat.journal.every(j => !j.autorisation || !/service_role/i.test(j.autorisation)));
  await page.close();

  // ══ B. COUPURE EN PLEIN ENVOI : REPRISE À L'OCTET EXACT ══
  etat.uploads = {}; etat.journal = []; etat.cheminAutorise = null;
  etat.confirmations = 0; etat.prolongations = 0;
  etat.couperApres = 6 * 1024 * 1024;   // coupe après le premier morceau
  etat.coupureFaite = false;

  page = await nouvellePage();
  await preparerVideo(page, TAILLE);
  r = await page.evaluate(() => uploadVideoCandidature());
  const upB = Object.values(etat.uploads).filter(u => u.chemin)[0];
  check('B1 : malgré la coupure, l\'envoi aboutit', r && r.ok === true, JSON.stringify(r));
  check('B2 : la coupure a bien eu lieu', etat.coupureFaite === true);
  check('B3 : le serveur a reçu tous les octets, une seule fois',
    upB && upB.recu === TAILLE, upB && (upB.recu + '/' + TAILLE));
  check('B4 : la reprise a interrogé l\'offset réel (HEAD) au lieu de tout renvoyer',
    etat.journal.some(j => j.methode === 'HEAD'), JSON.stringify(etat.journal.map(j => j.methode)));
  const octetsRenvoyes = (upB ? upB.morceaux.reduce((a, b) => a + b, 0) : 0);
  check('B5 : aucun octet déjà reçu n\'a été renvoyé',
    octetsRenvoyes === TAILLE, octetsRenvoyes + ' vs ' + TAILLE);
  await page.close();

  // ══ C. SIGNATURE EXPIRÉE EN COURS DE ROUTE ══
  etat.uploads = {}; etat.journal = []; etat.cheminAutorise = null;
  etat.confirmations = 0; etat.prolongations = 0;
  etat.couperApres = null; etat.coupureFaite = false;
  etat.expirerSignatureApres = 1;   // la 1re signature expire immédiatement

  page = await nouvellePage();
  await preparerVideo(page, TAILLE);
  await new Promise(r2 => setTimeout(r2, 30));
  r = await page.evaluate(() => uploadVideoCandidature());
  const upC = Object.values(etat.uploads).filter(u => u.chemin)[0];
  etat.expirerSignatureApres = null;
  check('C1 : une signature expirée ne fait pas échouer l\'envoi',
    r && r.ok === true, JSON.stringify(r));
  check('C2 : une signature fraîche a été demandée au serveur',
    etat.prolongations >= 1, String(etat.prolongations));
  check('C3 : et tous les octets sont bien arrivés',
    upC && upC.recu === TAILLE, upC && (upC.recu + '/' + TAILLE));
  check('C4 : le navigateur n\'a jamais choisi le chemin lui-même',
    upC && upC.chemin === etat.cheminAutorise, upC && upC.chemin);
  await page.close();

  // ══ D. CE QU'UN RECHARGEMENT COMPLET FAIT VRAIMENT ══
  //
  // La version précédente de cette section « prouvait » une reprise
  // après rechargement en rappelant preparerVideo() APRÈS le reload —
  // ce qui réinjectait à la fois le fichier ET le jeton secret. Elle ne
  // prouvait donc rien : elle reconstruisait à la main l'état que le
  // rechargement venait précisément de détruire.
  //
  // Ici, la page est rechargée POUR DE BON et rien n'est réinjecté.
  // Ce qui est vérifié est ce qui est réellement vrai : la reprise
  // couvre les coupures réseau tant que la page vit, et le
  // rechargement remet le candidat à zéro — sans laisser derrière lui
  // ni secret exploitable ni envoi fantôme.
  etat.uploads = {}; etat.journal = []; etat.cheminAutorise = null;
  etat.confirmations = 0; etat.prolongations = 0;
  etat.couperApres = 6 * 1024 * 1024; etat.coupureFaite = false;

  page = await nouvellePage();
  await preparerVideo(page, TAILLE);
  await page.evaluate(() => { TUS_REPRISES_MAX = 0; });
  const r1 = await page.evaluate(() => uploadVideoCandidature());
  const recuAvant = Object.values(etat.uploads).filter(u => u.chemin)[0].recu;
  check('D1 : l\'envoi s\'interrompt réellement', !!(r1 && r1.erreur), JSON.stringify(r1));
  check('D2 : mais une partie est déjà arrivée', recuAvant > 0, String(recuAvant));

  // RECHARGEMENT RÉEL. Aucune réinjection : ni fichier, ni jeton.
  etat.couperApres = null;
  const uploadsAvantReload = Object.keys(etat.uploads).filter(k => k.indexOf('up-') === 0).length;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof uploadVideoCandidature === 'function');

  const apresReload = await page.evaluate(() => ({
    jeton: _convJetonEnvoi,
    video: _convVideo ? { aFichier: !!_convVideo.fichier } : null,
    memoire: JSON.parse(JSON.stringify(_tusEnvoisEnCours || {})),
    heritee: localStorage.getItem('helixcar_video_reprise'),
    clesLocalStorage: Object.keys(localStorage)
  }));

  check('D3 : après un vrai rechargement, l\'autorisation d\'envoi a disparu',
    apresReload.jeton === null || apresReload.jeton === undefined,
    JSON.stringify(apresReload.jeton));
  check('D4 : le fichier choisi a disparu lui aussi — il n\'y a rien à reprendre',
    !apresReload.video || apresReload.video.aFichier === false,
    JSON.stringify(apresReload.video));
  check('D5 : aucun envoi en cours n\'est ressuscité',
    Object.keys(apresReload.memoire).length === 0, JSON.stringify(apresReload.memoire));
  check('D6 : AUCUN secret de reprise n\'est laissé dans le navigateur',
    apresReload.heritee === null, String(apresReload.heritee));
  check('D6b : aucune clé de stockage ne contient de jeton ni d\'URL signée',
    apresReload.clesLocalStorage.every(k => !/reprise|jeton|token|sign/i.test(k)),
    apresReload.clesLocalStorage.join(','));

  // Et surtout : une tentative d'envoi après rechargement ne peut PAS
  // aboutir en silence, et ne touche pas l'envoi partiel déjà déposé.
  const rApres = await page.evaluate(() => uploadVideoCandidature());
  const uploadsApresReload = Object.keys(etat.uploads).filter(k => k.indexOf('up-') === 0).length;
  check('D7 : relancer après rechargement ne prétend pas réussir',
    !(rApres && rApres.ok === true), JSON.stringify(rApres));
  check('D8 : et n\'écrit pas un octet de plus dans l\'envoi interrompu',
    uploadsApresReload === uploadsAvantReload
    && Object.values(etat.uploads).filter(u => u.chemin)[0].recu === recuAvant,
    uploadsApresReload + ' vs ' + uploadsAvantReload);
  check('D9 : aucune confirmation n\'a pu être obtenue sans le jeton',
    etat.confirmations === 0, String(etat.confirmations));

  // La documentation ne doit pas promettre plus que le code ne tient.
  const srcIdx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('D10 : le code dit explicitement que la reprise ne survit pas au rechargement',
    /ne couvre PAS un rechargement complet/.test(srcIdx));
  check('D11 : aucun secret d\'envoi n\'est écrit dans localStorage',
    !/localStorage\.setItem\([^)]*(jeton|reprise|token)/i.test(srcIdx));
  await page.close();

  // ══ D bis. LA REPRISE QUI EXISTE VRAIMENT : COUPURE, PAGE OUVERTE ══
  etat.uploads = {}; etat.journal = []; etat.cheminAutorise = null;
  etat.confirmations = 0; etat.prolongations = 0;
  etat.couperApres = 6 * 1024 * 1024; etat.coupureFaite = false;

  page = await nouvellePage();
  await preparerVideo(page, TAILLE);
  await page.evaluate(() => { TUS_REPRISES_MAX = 0; });
  const rd1 = await page.evaluate(() => uploadVideoCandidature());
  const recuCoupure = Object.values(etat.uploads).filter(u => u.chemin)[0].recu;
  check('D12 : premier essai interrompu', !!(rd1 && rd1.erreur), JSON.stringify(rd1));

  // Le réseau revient, la page n'a PAS été rechargée : le candidat
  // relance, et l'envoi doit repartir où il en était.
  etat.couperApres = null;
  await page.evaluate(() => { TUS_REPRISES_MAX = 5; });
  const rd2 = await page.evaluate(() => uploadVideoCandidature());
  const upDbis = Object.values(etat.uploads).filter(u => u.chemin)[0];
  check('D13 : la relance aboutit sans recharger la page',
    rd2 && rd2.ok === true, JSON.stringify(rd2));
  check('D14 : elle a REPRIS l\'envoi existant, sans en créer un second',
    Object.keys(etat.uploads).filter(k => k.indexOf('up-') === 0).length === 1,
    JSON.stringify(Object.keys(etat.uploads)));
  check('D15 : et n\'a renvoyé que ce qui manquait',
    upDbis && upDbis.recu === TAILLE
    && upDbis.morceaux.reduce((a, b) => a + b, 0) === TAILLE
    && recuCoupure > 0 && recuCoupure < TAILLE,
    upDbis && (upDbis.recu + ' / reprise à ' + recuCoupure));
  await page.close();

  // ══ E. SECOURS SI LA ROUTE REPRENABLE N'EXISTE PAS ══
  etat.uploads = {}; etat.journal = []; etat.cheminAutorise = null; etat.confirmations = 0;
  page = await nouvellePage();
  await preparerVideo(page, 2 * 1024 * 1024);
  // On simule une plateforme sans route reprenable : le POST de création
  // répond 404, exactement comme une version de stockage plus ancienne.
  await page.evaluate(() => {
    const reel = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (m === 'POST' && String(u).indexOf('/upload/resumable/sign') !== -1) {
        u = String(u).replace('/upload/resumable/sign', '/upload/inexistant');
      }
      return reel.call(this, m, u, true);
    };
  });
  r = await page.evaluate(() => uploadVideoCandidature());
  check('E1 : sans route reprenable, l\'envoi passe par le secours et aboutit',
    r && r.ok === true, JSON.stringify(r));
  check('E2 : le secours est bien l\'envoi en une requête signée',
    !!etat.uploads['secours'], JSON.stringify(Object.keys(etat.uploads)));
  await page.close();

  // ══ G. ANNULATION, POURCENTAGE ET NOUVELLE TENTATIVE ══
  etat.uploads = {}; etat.journal = []; etat.cheminAutorise = null;
  etat.confirmations = 0; etat.prolongations = 0;
  etat.couperApres = null; etat.coupureFaite = false;

  page = await nouvellePage();
  await preparerVideo(page, TAILLE);
  await page.evaluate(() => {
    // On rétablit la vraie fonction de progression pour observer
    // l'affichage réellement présenté au candidat.
    delete window.convMajProgressionVideo;
    _convVideoEtat = 'envoi';
    convMajAffichageVideo();
  });
  await page.waitForTimeout(150);
  const pendant = await page.evaluate(() => ({
    annulerVisible: (document.getElementById('conv-video-annuler') || {}).style.display,
    reessayerVisible: (document.getElementById('conv-video-reessayer') || {}).style.display,
    pourcent: (document.getElementById('conv-video-pourcent') || {}).textContent,
  }));
  check('G1 : pendant l\'envoi, le bouton « Annuler l\'envoi » est proposé',
    pendant.annulerVisible === 'inline-flex', JSON.stringify(pendant));
  check('G2 : et « Réessayer » ne l\'est pas', pendant.reessayerVisible === 'none', pendant.reessayerVisible);
  check('G3 : un pourcentage lisible est affiché, pas seulement une barre',
    /%/.test(pendant.pourcent || ''), pendant.pourcent);

  await page.evaluate(() => { _convVideoEtat = 'erreur'; convMajAffichageVideo(); });
  await page.waitForTimeout(100);
  const apresEchec = await page.evaluate(() => ({
    annulerVisible: (document.getElementById('conv-video-annuler') || {}).style.display,
    reessayerVisible: (document.getElementById('conv-video-reessayer') || {}).style.display,
  }));
  check('G4 : après un échec, « Réessayer l\'envoi » apparaît',
    apresEchec.reessayerVisible === 'inline-flex', JSON.stringify(apresEchec));
  check('G5 : et « Annuler » disparaît', apresEchec.annulerVisible === 'none', apresEchec.annulerVisible);

  // Annulation RÉELLE au milieu de l'envoi.
  //
  // Le déclencheur ne peut pas être un pourcentage. La progression
  // affichée mélange volontairement deux choses — les octets déjà
  // acquittés par le serveur ET ceux encore en vol dans la requête
  // courante — parce que c'est ce que le candidat doit voir. Sur une
  // machine chargée, un événement de progression tombe EN PLEIN VOL du
  // premier morceau : annuler à ce moment-là coupe la requête avant que
  // le serveur n'ait rien enregistré, et « l'envoi s'est arrêté avant la
  // fin » devient indémontrable. C'est exactement ce qui a fait tomber
  // G7 et G13 sur un runner GitHub, avec 0 octet reçu.
  //
  // On annule donc sur un fait, pas sur un affichage : la FIN d'une
  // requête PATCH. À cet instant le serveur a acquitté le morceau, et
  // aucune requête n'est en vol — l'annulation ne peut donc tronquer
  // aucun envoi. C'est vrai quelle que soit la vitesse de la machine.
  await page.evaluate(() => {
    _convVideoEtat = 'envoi';
    window.__progression = [];
    const ouvrirReel = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__methode = m;
      return ouvrirReel.apply(this, arguments);
    };
    const envoyerReel = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => {
        if (this.__methode === 'PATCH' && !window.__dejaAnnule) {
          window.__dejaAnnule = true;
          window.__annule = true;
          convAnnulerEnvoiVideo();
        }
      });
      return envoyerReel.apply(this, arguments);
    };
    const vrai = convMajProgressionVideo;
    window.convMajProgressionVideo = function (p) {
      window.__progression.push(p);
      vrai(p);
    };
  });
  const rAnnule = await page.evaluate(() => uploadVideoCandidature());
  const upG = Object.values(etat.uploads).filter(u => u.chemin)[0];
  check('G6 : l\'annulation est rapportée comme telle, pas comme un échec',
    rAnnule && rAnnule.annule === true, JSON.stringify(rAnnule));
  check('G7 : l\'envoi s\'arrête réellement avant la fin',
    upG && upG.recu < TAILLE && upG.recu > 0, upG && (upG.recu + '/' + TAILLE));
  check('G8 : aucune confirmation n\'est envoyée après une annulation',
    etat.confirmations === 0, String(etat.confirmations));
  check('G9 : la trace de reprise est CONSERVÉE — relancer ne recommence pas tout',
    await page.evaluate(() => Object.keys(_tusEnvoisEnCours || {}).length === 1),
    'envois mémorisés : ' + JSON.stringify(await page.evaluate(() => Object.keys(_tusEnvoisEnCours || {}))));
  check('G9b : elle est gardée EN MÉMOIRE, jamais écrite dans le navigateur',
    await page.evaluate(() => localStorage.getItem('helixcar_video_reprise') === null));

  // Relance : elle reprend là où l'annulation s'était arrêtée.
  const recuApresAnnulation = upG.recu;
  await page.evaluate(() => {
    window.__annule = false;
    window.convMajProgressionVideo = function (p) { window.__progression.push(p); };
  });
  const rRelance = await page.evaluate(() => uploadVideoCandidature());
  const upG2 = Object.values(etat.uploads).filter(u => u.chemin)[0];
  check('G10 : la relance aboutit', rRelance && rRelance.ok === true, JSON.stringify(rRelance));
  check('G11 : elle a REPRIS l\'envoi annulé, sans en créer un second',
    Object.keys(etat.uploads).filter(k => k.indexOf('up-') === 0).length === 1,
    JSON.stringify(Object.keys(etat.uploads)));
  check('G12 : et n\'a renvoyé que les octets manquants',
    upG2 && upG2.recu === TAILLE
    && upG2.morceaux.reduce((a, b) => a + b, 0) === TAILLE,
    upG2 && (upG2.recu + ' / ' + upG2.morceaux.join('+')));
  check('G13 : la progression a bien repris au-dessus de zéro',
    recuApresAnnulation > 0);
  await page.close();

  // ══ F. CE QUI NE DOIT JAMAIS ARRIVER ══
  const src = fs.readFileSync(fichier('index.html'), 'utf8');
  const fn = fs.readFileSync(fichier('supabase/functions/candidature-video/index.ts'), 'utf8');
  check('F1 : le navigateur ne contient aucune clé service_role',
    !/service_role/i.test(src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('F2 : la fonction serveur ne renvoie jamais la clé au navigateur',
    !/reponseJson\([^)]*SERVICE_ROLE/i.test(fn));
  check('F3 : le bucket n\'est jamais rendu public',
    !/public\s*:\s*true/.test(fn) && !/makePublic/i.test(src));
  check('F4 : la vidéo ne transite pas par la fonction serveur',
    !/body:\s*_convVideo\.fichier/.test(src)
    && src.indexOf('URL_FONCTION_VIDEO') !== -1
    && !/URL_FONCTION_VIDEO[\s\S]{0,400}fichier/.test(src));
  check('F5 : la nouvelle action ne resigne QUE le chemin déjà enregistré',
    // V01 : l'envoi en cours vit dans video_envoi_chemin (deux phases) ;
    // la prolongation ne resigne que ce chemin-la, jamais un chemin recu.
    /createSignedUploadUrl\(c\.video_envoi_chemin/.test(fn)
    && !/createSignedUploadUrl\(\s*corps/.test(fn)
    && !/createSignedUploadUrl\(c\.video_chemin\b/.test(fn));
  check('F6 : elle ne consomme pas le jeton à usage unique',
    !/actionProlonger[\s\S]*?video_upload_jeton_hash:\s*null/.test(
      fn.slice(fn.indexOf('export async function actionProlonger'),
               fn.indexOf('ACTION 2 — CONFIRMER'))));
  check('F7 : elle refuse une vidéo déjà confirmée',
    /DEJA_CONFIRMEE/.test(fn));
  check('F8 : le chemin resigné appartient forcément à la candidature',
    /startsWith\(`candidatures\/\$\{c\.id\}\//.test(fn));

  await browser.close();
  serveur.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
