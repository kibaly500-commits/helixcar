// ══════════════════════════════════════════════════════════════════
// LOT C1 — LA NOUVELLE DEMANDE SE FAIT DANS L'ESPACE CLIENT
// ══════════════════════════════════════════════════════════════════
// CE QUI ÉTAIT CONSTATÉ : « Faire une nouvelle demande » quittait le
// Dashboard pour la vitrine. La navigation disparaissait, et le client
// se retrouvait devant la grosse modale publique.
//
// Le vrai code des deux pages est exécuté contre un double Supabase.
const { lancerNavigateur, urlFichier, fichier, RACINE } = require('./env.js');
const fs = require('fs');
const http = require('http');
const path = require('path');

// UN VRAI SERVEUR LOCAL, et non file://.
//
// Le dialogue entre l'espace client et le formulaire integre repose sur
// postMessage restreint a NOTRE origine. Or une page ouverte en file://
// a pour origine « null » : deux fichiers voisins y sont consideres
// comme etrangers l'un a l'autre, et le navigateur bloque tout. Ce
// n'est pas le cas en production, ou les deux pages sont servies par le
// meme https://. On sert donc les fichiers reels — jamais des copies —
// depuis 127.0.0.1, ce que tests/env.js autorise explicitement.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                '.css': 'text/css', '.json': 'application/json' };
const serveur = http.createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const fichierServi = path.join(RACINE, chemin === '/' ? '/index.html' : chemin);
  // Jamais hors du depot.
  if (!fichierServi.startsWith(RACINE)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fichierServi, (err, buf) => {
    if (err) { res.writeHead(404); res.end('introuvable'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichierServi)] || 'application/octet-stream' });
    res.end(buf);
  });
});

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 280) + ']' : '')); fail++; echecs.push(l); }
}

const INIT = `
window.__journal = [];
window.__uid = '55555555-5555-5555-5555-555555555555';
window.__session = { access_token: 'jwt', user: { id: window.__uid, email: 'clientA@helixcar.test' } };
window.__demandes = [{
  id: 'dem-1', numero_client: 'TEST-QA-C1-A', type_service: 'convoyage', statut: 'nouveau',
  prenom: 'TEST-QA', nom: 'ClientA', email: 'clientA@helixcar.test',
  telephone: '+33600000010', type_client: 'pro', societe: 'TEST-QA Flotte SAS',
  created_at: '2026-09-01T10:00:00Z'
}];
function _table(nom) {
  const api = {
    select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; },
    then(res) {
      const lignes = (nom === 'v_mes_demandes') ? window.__demandes.slice() : [];
      return Promise.resolve({ data: lignes, error: null }).then(res);
    },
    update() { return { eq() { return Promise.resolve({ error: null }); } }; },
    insert() { return Promise.resolve({ error: null }); }
  };
  return api;
}
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function () { return { data: { session: window.__session, user: window.__session.user }, error: null }; },
    signOut: async function () { return {}; }
  },
  from: _table,
  rpc: async function (nom, params) {
    window.__journal.push({ op: 'rpc', nom, params });
    if (nom === 'roles_utilisateur') return { data: [{ role: 'client' }], error: null };
    if (nom === 'creer_demande_avec_vehicules') {
      // Le serveur enregistre, et RENVOIE ce qu'il a enregistre.
      window.__demandes.unshift({
        id: 'dem-2', numero_client: 'TEST-QA-C1-SERVEUR', type_service: 'convoyage',
        statut: 'nouveau', prenom: 'TEST-QA', nom: 'ClientA',
        email: 'clientA@helixcar.test', created_at: '2026-09-09T10:00:00Z'
      });
      return { data: { id: 'dem-2', numero_client: 'TEST-QA-C1-SERVEUR', vehicules: 1 }, error: null };
    }
    return { data: null, error: null };
  },
  storage: { from: function () { return {}; } }
}; } };
window.emailjs = { init: function () {}, send: function () { return Promise.resolve(); } };
const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  const i = url.indexOf('/rest/v1/');
  if (i === -1) return _fetchReel.apply(window, arguments);
  return Promise.resolve({ ok: true, status: 200,
    json: function () { return Promise.resolve([]); },
    text: function () { return Promise.resolve('[]'); },
    headers: { get: function () { return null; } } });
};
`;

(async () => {
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + serveur.address().port;
  const navigateur = await lancerNavigateur();
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');

  // ══ A. LE FORMULAIRE S'OUVRE SANS QUITTER L'ESPACE ══
  {
    const page = await navigateur.newPage({ viewport: { width: 1400, height: 1000 } });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(INIT);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.evaluate(async () => {
      // Lot A01 : le Dashboard ne connecte plus personne ; la session vient du site.
      var __r = await sbAuth.auth.signInWithPassword({ email: 'clientA@helixcar.test', password: 'x' });
      var __uid = (__r && __r.data && __r.data.user) ? __r.data.user.id : null;
      var __ok = await finaliserSessionClient('clientA@helixcar.test', null, __uid);
      if (__ok !== false) await _hcPreparerRoles('client', 'clientA@helixcar.test', __uid);
    });
    await page.waitForTimeout(250);

    const urlAvant = page.url();
    await page.evaluate(() => ouvrirNouvelleDemande());
    await page.waitForTimeout(400);
    const etat = await page.evaluate(() => ({
      url: window.location.href,
      pageActive: (document.querySelector('.page.active') || {}).id,
      navVisible: document.querySelectorAll('#sidebar-nav .nav-item').length > 0
        && getComputedStyle(document.querySelector('.sidebar')).display !== 'none',
      barreHaut: !!document.getElementById('topbar-title'),
      titre: (document.getElementById('topbar-title') || {}).textContent,
      cadre: !!document.getElementById('client-demande-cadre'),
      src: (document.getElementById('client-demande-cadre') || {}).getAttribute('src')
    }));
    check('A1 : on ne quitte PAS le Dashboard',
      etat.url === urlAvant, etat.url + ' vs ' + urlAvant);
    check('A2 : la navigation de l\'espace reste visible',
      etat.navVisible === true && etat.barreHaut === true, JSON.stringify(etat));
    check('A3 : la page dédiée est active, avec son titre',
      etat.pageActive === 'page-client-nouvelle-demande'
      && /Nouvelle demande/.test(etat.titre || ''), JSON.stringify(etat));
    check('A4 : le formulaire chargé est le VRAI, en mode intégré',
      etat.cadre === true && /index\.html\?nouvelle-demande=1&integre=1/.test(etat.src || ''),
      String(etat.src));

    // Le contenu du cadre : le vrai formulaire, sans la vitrine.
    await page.waitForTimeout(900);
    const cadres = page.frames().filter(f => /index\.html/.test(f.url()));
    check('A5 : le cadre a bien chargé le formulaire', cadres.length === 1, String(cadres.length));
    if (cadres.length === 1) {
      const dedans = await cadres[0].evaluate(() => ({
        integre: document.body.classList.contains('hc-integre'),
        modaleOuverte: (document.getElementById('modal-client') || {}).classList
          ? document.getElementById('modal-client').classList.contains('open') : false,
        overlayFond: getComputedStyle(document.getElementById('modal-client')).backgroundColor,
        position: getComputedStyle(document.getElementById('modal-client')).position,
        croix: getComputedStyle(document.querySelector('#modal-client .modal-close')).display,
        vitrineVisible: Array.prototype.slice.call(document.body.children)
          .filter(e => !e.classList.contains('modal-overlay') && e.tagName !== 'SCRIPT'
                       && e.tagName !== 'STYLE' && e.tagName !== 'LINK')
          .some(e => getComputedStyle(e).display !== 'none'),
        etape: _formStepState.client,
        emailVerrouille: (document.getElementById('client-email') || {}).readOnly,
        mdpRequis: (document.getElementById('client-password') || {}).required
      }));
      check('A6 : le mode intégré est bien actif',
        dedans.integre === true, JSON.stringify(dedans));
      check('A7 : plus de grosse modale flottante — un bloc dans la page',
        dedans.position === 'static'
        && /rgba\(0, 0, 0, 0\)|transparent/.test(dedans.overlayFond), JSON.stringify(dedans));
      check('A8 : la vitrine publique est effacée',
        dedans.vitrineVisible === false, JSON.stringify(dedans));
      check('A9 : la croix de la modale disparaît — c\'est « Retour » qui referme',
        dedans.croix === 'none', dedans.croix);
      check('A10 : le parcours démarre à « Comment pouvons-nous vous accompagner ? »',
        String(dedans.etape) === '2', String(dedans.etape));
      check('A11 : ni compte ni e-mail ne sont redemandés',
        dedans.emailVerrouille === true && dedans.mdpRequis === false, JSON.stringify(dedans));

      // C'est bien LE MÊME formulaire : mêmes fonctions métier.
      const memeCode = await cadres[0].evaluate(() => ({
        services: ['stockage', 'convoyage', 'professionnel', 'nettoyage']
          .filter(v => !!document.querySelector('input[name="type-service"][value="' + v + '"]')),
        fonctions: ['_construireDetailsNettoyage', '_construireDetailsProfessionnel',
                    '_lireFichesVehicules', '_hcOuvrirCalendrier', '_validateClientStep']
          .filter(f => typeof window[f] === 'function')
      }));
      check('A12 : les quatre services sont proposés, comme dans le parcours public',
        memeCode.services.length === 4, JSON.stringify(memeCode.services));
      check('A13 : et ce sont les mêmes règles métier, pas une copie',
        memeCode.fonctions.length === 5, JSON.stringify(memeCode.fonctions));
    }

    // Retour : on revient à ses demandes, toujours sans quitter la page.
    await page.evaluate(() => fermerNouvelleDemande());
    await page.waitForTimeout(200);
    const retour = await page.evaluate(() => ({
      url: window.location.href,
      pageActive: (document.querySelector('.page.active') || {}).id
    }));
    check('A14 : « Retour » ramène aux demandes, sans quitter l\'espace',
      retour.pageActive === 'page-client-dashboard' && retour.url === urlAvant,
      JSON.stringify(retour));
    check('A15 : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
    await page.close();
  }

  // ══ B. APRÈS SOUMISSION : LA RÉFÉRENCE VIENT DU SERVEUR ══
  {
    const page = await navigateur.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('dialog', d => d.accept());
    await page.addInitScript(INIT);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.evaluate(async () => {
      // Lot A01 : le Dashboard ne connecte plus personne ; la session vient du site.
      var __r = await sbAuth.auth.signInWithPassword({ email: 'clientA@helixcar.test', password: 'x' });
      var __uid = (__r && __r.data && __r.data.user) ? __r.data.user.id : null;
      var __ok = await finaliserSessionClient('clientA@helixcar.test', null, __uid);
      if (__ok !== false) await _hcPreparerRoles('client', 'clientA@helixcar.test', __uid);
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => ouvrirNouvelleDemande());
    await page.waitForTimeout(900);

    // Le formulaire annonce l'enregistrement, exactement comme le vrai
    // code le fait à la fin de la soumission.
    const cadres = page.frames().filter(f => /index\.html/.test(f.url()));
    if (cadres.length === 1) {
      await cadres[0].evaluate(() => {
        // Une demande de plus existe désormais côté serveur.
        parent.window.__demandes.unshift({
          id: 'dem-3', numero_client: 'TEST-QA-C1-SERVEUR', type_service: 'convoyage',
          statut: 'nouveau', email: 'clientA@helixcar.test', created_at: '2026-09-09T11:00:00Z'
        });
        _hcPrevenirEspaceClient();
      });
      await page.waitForTimeout(600);
      const apres = await page.evaluate(() => ({
        pageActive: (document.querySelector('.page.active') || {}).id,
        liste: (document.getElementById('client-demandes-liste') || {}).textContent || ''
      }));
      check('B1 : l\'espace revient sur la liste des demandes',
        apres.pageActive === 'page-client-dashboard', JSON.stringify(apres.pageActive));
      check('B2 : la référence enregistrée par le SERVEUR y apparaît',
        /TEST-QA-C1-SERVEUR/.test(apres.liste), apres.liste.slice(0, 220));
      check('B3 : avec son statut',
        /nouveau|Nouvelle|En attente|Reçue/i.test(apres.liste), apres.liste.slice(0, 220));
    } else {
      check('B1 : le cadre est chargé', false, 'cadres=' + cadres.length);
    }
    await page.close();
  }

  // ══ C. LE MESSAGE N'EST ACCEPTÉ QUE DU BON EXPÉDITEUR ══
  {
    const page = await navigateur.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('dialog', d => d.accept());
    await page.addInitScript(INIT);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.evaluate(async () => {
      // Lot A01 : le Dashboard ne connecte plus personne ; la session vient du site.
      var __r = await sbAuth.auth.signInWithPassword({ email: 'clientA@helixcar.test', password: 'x' });
      var __uid = (__r && __r.data && __r.data.user) ? __r.data.user.id : null;
      var __ok = await finaliserSessionClient('clientA@helixcar.test', null, __uid);
      if (__ok !== false) await _hcPreparerRoles('client', 'clientA@helixcar.test', __uid);
    });
    await page.waitForTimeout(250);
    const usurpation = await page.evaluate(async () => {
      const avant = (document.querySelector('.page.active') || {}).id;
      // Message envoyé par la page elle-même, PAS par le cadre.
      window.postMessage({ type: 'hc-demande-enregistree' }, window.location.origin);
      await new Promise(r => setTimeout(r, 300));
      return { avant, apres: (document.querySelector('.page.active') || {}).id };
    });
    check('C1 : un message qui ne vient pas du cadre est ignoré',
      usurpation.apres === usurpation.avant, JSON.stringify(usurpation));
    await page.close();
  }

  // ══ D. LE CODE ══
  check('D1 : aucune copie du formulaire dans le Dashboard',
    !/id="modal-client"/.test(dash) && !/_construireDetailsNettoyage/.test(dash));
  check('D2 : le message n\'est accepté que de notre propre origine',
    /if \(ev\.origin !== window\.location\.origin\) return;/.test(dash));
  check('D3 : et que de notre propre cadre',
    /if \(!cadre \|\| ev\.source !== cadre\.contentWindow\) return;/.test(dash));
  check('D4 : la liste est rechargée depuis la base, jamais depuis le message',
    /chargerDemandesClient\(\);/.test(dash.slice(dash.indexOf('hc-demande-enregistree'),
                                                 dash.indexOf('hc-demande-enregistree') + 900)));
  check('D5 : le mode intégré exige d\'être réellement encadré',
    /p\.get\('integre'\) === '1' && window\.parent !== window/.test(idx));
  check('D6 : le parcours public reste séparé et intact',
    /params\.get\('nouvelle-demande'\) !== '1'\) return false;/.test(idx));
  check('D7 : l\'écran de succès public ne s\'affiche pas dans l\'espace client',
    /if \(type === 'client' && typeof _hcModeIntegre === 'function' && _hcModeIntegre\(\)\)/.test(idx));

  await navigateur.close();
  await new Promise(r => serveur.close(r));
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
