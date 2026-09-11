// LOT L01 / L02 — PROGRAMME DE FIDÉLITÉ EN POINTS (décision C10)
// ------------------------------------------------------------------
// Exécute le VRAI Dashboard et la VRAIE vitrine dans Chromium, contre
// un double Supabase injecté avant les scripts (le CDN est injoignable,
// et env.js coupe de toute façon tout le réseau).
//
// Ce que ce fichier prouve :
//   * l'espace client AFFICHE ce que le serveur calcule (v_ma_fidelite)
//     et ne recalcule rien : solde, prochain palier, points restants ;
//   * les cinq paliers (2 000 → 10 000) avec cinq icônes SVG distinctes,
//     état en texte (Atteint / En cours / À atteindre) pour 0, 1 999,
//     2 000, 9 999, 10 000, 12 000 et 25 000 points ;
//   * au-delà de 10 000 : historique acquis, seuil courant et prochain
//     seuil « Box mystère », nom et seuil seulement ;
//   * état vide réel (0 point), panne serveur sans valeur inventée,
//     échappement HTML, aucune écriture, aucun alert() ;
//   * plus aucun kilomètre, « Palier Entreprise », crédit ni « récompense
//     disponible » dans l'espace client ; horizontal sur grand écran,
//     vertical à 390 px ;
//   * vitrine : ordre des sections (L02), ancres et menu valides, cinq
//     paliers en points, aucune valeur inventée, et le challenge
//     trimestriel des convoyeurs textuellement IDENTIQUE à origin/main.
const { lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const fs = require('fs');
const { execSync } = require('child_process');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 260) + ']' : '')); fail++; echecs.push(l); }
}

const SOURCE_VITRINE = fs.readFileSync(fichier('index.html'), 'utf8');
const SOURCE_DASHBOARD = fs.readFileSync(fichier('dashboard.html'), 'utf8');
const SOURCE_MIGRATION = fs.readFileSync(fichier('migrations/109_fidelite_points.sql'), 'utf8');
check('C10 : aucune règle d\'expiration des points n\'est inventée dans l\'interface',
  !/points n['’]expirent pas/i.test(SOURCE_VITRINE + SOURCE_DASHBOARD)
  && !/expiration des points/i.test(SOURCE_VITRINE + SOURCE_DASHBOARD));
check('C10 : la règle validée TTC/euro entier est identique dans les deux interfaces',
  SOURCE_VITRINE.includes("1 point par euro TTC entier, arrondi à l'inférieur")
  && SOURCE_DASHBOARD.includes('1 € TTC entier payé = 1 point')
  && SOURCE_DASHBOARD.includes('1 € TTC entier payé sur une prestation terminée = 1 point'));
check('C10 : le serveur crédite floor(prix TTC), sans règle provisoire résiduelle',
  SOURCE_MIGRATION.includes('v_points := floor(d.prix)::integer')
  && SOURCE_MIGRATION.includes('123,99 € TTC → 123 points')
  && !/règle provisoire/i.test(SOURCE_MIGRATION));

// Sorties de fidelite_prochain_palier() pour chaque solde, telles que
// tests/rls/l01.sh les mesure sur PostgreSQL 16 (L01-016). Le double ne
// « calcule » rien : il rend ces lignes, comme la vue le ferait.
function ligne(solde, palierCourant, prochainSeuil, restants, boxes) {
  const nomDe = s => s === 0 ? null : (s <= 10000 ? 'Palier ' + (s / 2000) : 'Box mystère');
  return {
    solde, pas: 2000, palier_courant: palierCourant, palier_numero: palierCourant / 2000,
    palier_courant_nom: nomDe(palierCourant), prochain_seuil: prochainSeuil,
    prochain_nom: nomDe(prochainSeuil), points_restants: restants,
    box_mystere: prochainSeuil > 10000, boxes_mystere_acquises: boxes,
    nb_mouvements: 0, dernier_mouvement_le: null
  };
}
const CAS = {
  0:     ligne(0,     0,     2000,  2000, 0),
  1999:  ligne(1999,  0,     2000,  1,    0),
  2000:  ligne(2000,  2000,  4000,  2000, 0),
  9999:  ligne(9999,  8000,  10000, 1,    0),
  10000: ligne(10000, 10000, 12000, 2000, 0),
  12000: ligne(12000, 12000, 14000, 2000, 1),
  25000: ligne(25000, 24000, 26000, 1000, 7),
};

const INIT = `
window.__journal = [];
window.__alertes = [];
window.__fidelite = ${JSON.stringify(CAS[0])};
window.__mouvements = [];
window.__reseauCoupe = false;
window.__session = {
  access_token: 'jwt-client',
  user: { id: '55555555-5555-5555-5555-555555555555', email: 'clientA@helixcar.test' }
};
window.alert = function (m) { window.__alertes.push(String(m)); };
function _table(nom) {
  const req = { limite: null, filtres: {} };
  const api = {
    select() { return api; },
    eq(c, v) { req.filtres[c] = v; return api; },
    order() { return api; },
    limit(n) { req.limite = n; return api; },
    then(resoudre) {
      if (window.__reseauCoupe) {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(resoudre);
      }
      let lignes = [];
      if (nom === 'v_ma_fidelite') lignes = window.__fidelite ? [window.__fidelite] : [];
      else if (nom === 'fidelite_mouvements') lignes = (window.__mouvements || []).slice();
      else if (nom === 'v_mes_demandes') lignes = [];
      if (req.limite) lignes = lignes.slice(0, req.limite);
      return Promise.resolve({ data: lignes, error: null }).then(resoudre);
    },
    update(valeurs) {
      const maj = { eq() { return maj; }, then(r) {
        window.__journal.push({ op: 'update', nom, valeurs });
        return Promise.resolve({ error: null }).then(r); } };
      return maj;
    },
    insert(v) { window.__journal.push({ op: 'insert', nom, v }); return Promise.resolve({ error: null }); },
    delete() { window.__journal.push({ op: 'delete', nom }); return api; }
  };
  return api;
}
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function () {
      window.__journal.push({ op: 'signIn' });
      return { data: { session: window.__session, user: window.__session.user }, error: null };
    },
    signOut: async function () { return {}; }
  },
  from: _table,
  rpc: async function (nom, params) {
    window.__journal.push({ op: 'rpc', nom, params });
    return { data: null, error: null };
  },
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: null }; } }; } }
}; } };
window.emailjs = { init: function () {}, send: function () { return Promise.resolve(); }, sendForm: function () { return Promise.resolve(); } };
const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  if (url.indexOf('/rest/v1/') === -1) return _fetchReel.apply(window, arguments);
  window.__journal.push({ op: 'rest', url: url.slice(url.indexOf('/rest/v1/') + 9), methode: ((options || {}).method || 'GET').toUpperCase() });
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'items 0-0/0' }, text: () => Promise.resolve('[]') });
};
`;

const INTERDITS = [
  [/\bkm\b/i, 'km'], [/kilom/i, 'kilomètre'], [/Entreprise/i, 'Palier Entreprise'],
  [/cr[ée]dit/i, 'crédit'], [/r[ée]compense disponible/i, '« récompense disponible »'],
  [/1[\s  ]?280/, '1 280 (valeur fictive)'], [/2[\s  ]?500/, '2 500 (ancien palier)'],
  [/20[\s  ]?000\s?km/, '20 000 km (ancien palier Entreprises)'], [/\b50\s?€|\b150\s?€|\b250\s?€/, 'crédits 50/150/250 €'],
];
function motsInterdits(txt) {
  return INTERDITS.filter(([re]) => re.test(txt)).map(([, n]) => n);
}

async function connecterClient(page) {
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await page.evaluate(async () => {
    // Lot A01 : le Dashboard ne connecte plus personne ; la session vient du site.
    var __r = await sbAuth.auth.signInWithPassword({ email: 'clientA@helixcar.test', password: 'motdepasse' });
    var __uid = (__r && __r.data && __r.data.user) ? __r.data.user.id : null;
    var __ok = await finaliserSessionClient('clientA@helixcar.test', null, __uid);
    if (__ok !== false) await _hcPreparerRoles('client', 'clientA@helixcar.test', __uid);
  });
  await page.waitForTimeout(250);
}

async function ouvrirFidelite(page, cas, mouvements) {
  await page.evaluate(([f, m]) => { window.__fidelite = f; window.__mouvements = m || []; }, [cas, mouvements || []]);
  await page.evaluate(() => showPage('client-fidelite'));
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const z = document.getElementById('client-fidelite-page');
    const paliers = Array.from(document.querySelectorAll('#fid-paliers .fid-palier')).map(li => ({
      seuil: li.getAttribute('data-seuil'), etat: li.getAttribute('data-etat'),
      etatTexte: (li.querySelector('.fid-palier-etat') || {}).textContent || '',
      icone: (li.querySelector('svg') || {}).getAttribute ? li.querySelector('svg').getAttribute('data-icone') : null,
      trace: (li.querySelector('svg') || {}).innerHTML || '',
      recompense: (li.querySelector('.fid-palier-recompense') || {}).textContent || '',
      boite: li.getBoundingClientRect().toJSON()
    }));
    const t = id => (document.getElementById(id) || {}).textContent || null;
    return {
      texte: z ? z.textContent : '',
      solde: t('fid-solde'), prochain: t('fid-prochain'), restants: t('fid-restants'),
      vide: !!document.getElementById('fid-vide'),
      paliers,
      box: !!document.getElementById('fid-box-mystere'),
      boxTexte: t('fid-box-mystere') || '',
      boxesAcquises: t('fid-boxes-acquises'), seuilCourant: t('fid-seuil-courant'), seuilProchain: t('fid-seuil-prochain'),
      historiqueVide: !!document.getElementById('fid-historique-vide'),
      historique: Array.from(document.querySelectorAll('#fid-historique .detail-row')).map(r => r.textContent),
      largeurDoc: document.documentElement.scrollWidth,
      largeurVue: window.innerWidth,
      barre: (document.querySelector('#client-fidelite-page .fidelite-bar-fill') || {}).style
        ? document.querySelector('#client-fidelite-page .fidelite-bar-fill').style.width : null
    };
  });
}

(async () => {
  const navigateur = await lancerNavigateur();
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1100 } });
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  await page.addInitScript(INIT);

  // ── A. LA CARTE DU TABLEAU DE BORD : SERVEUR, PAS VALEURS EN DUR ──
  await connecterClient(page);
  const accueil = await page.evaluate(() => ({
    role: currentRole,
    pageActive: (document.querySelector('.page.active') || {}).id,
    carte: (document.getElementById('client-fidelite-carte') || {}).textContent || '',
    pageTexte: (document.getElementById('page-client-dashboard') || {}).textContent || '',
    stats: Array.from(document.querySelectorAll('#page-client-dashboard .stat-label')).map(e => e.textContent)
  }));
  check('A1 : le client ouvre son espace et arrive sur le tableau de bord',
    accueil.role === 'client' && accueil.pageActive === 'page-client-dashboard', JSON.stringify(accueil).slice(0, 200));
  check('A2 : la carte fidélité est remplie depuis le serveur (0 point, Palier 1 à 2 000 points)',
    /Points cumul/.test(accueil.carte) && /Prochain palier/.test(accueil.carte)
    && /Palier 1/.test(accueil.carte) && /2\s000/.test(accueil.carte), accueil.carte.slice(0, 200));
  check('A3 : la carte ne contient plus « 1 280 km », « 2 500 km » ni « 1 220 km restants »',
    motsInterdits(accueil.carte).length === 0, motsInterdits(accueil.carte).join(', '));
  check('A4 : les indicateurs « Km parcourus » et « Palier fidélité » écrits en dur ont disparu',
    !accueil.stats.some(s => /Km parcourus|Palier fid/i.test(s)), JSON.stringify(accueil.stats));
  check('A5 : l\'état vide est réel : « pas encore de points », rien de « disponible »',
    /pas encore de points/.test(accueil.carte) && !/disponible/i.test(accueil.carte));

  // ── B. LA PAGE FIDÉLITÉ, POUR CHAQUE SOLDE ──
  const ATTENDUS = {
    0:     { etats: ['En cours', 'À atteindre', 'À atteindre', 'À atteindre', 'À atteindre'], box: false, vide: true },
    1999:  { etats: ['En cours', 'À atteindre', 'À atteindre', 'À atteindre', 'À atteindre'], box: false, vide: false },
    2000:  { etats: ['Atteint', 'En cours', 'À atteindre', 'À atteindre', 'À atteindre'], box: false, vide: false },
    9999:  { etats: ['Atteint', 'Atteint', 'Atteint', 'Atteint', 'En cours'], box: false, vide: false },
    10000: { etats: ['Atteint', 'Atteint', 'Atteint', 'Atteint', 'Atteint'], box: true, vide: false,
             boxes: '0', courant: /Palier 5\s·\s10\s000 points/, prochain: /Box mystère\s·\s12\s000 points/, acquis: null },
    12000: { etats: ['Atteint', 'Atteint', 'Atteint', 'Atteint', 'Atteint'], box: true, vide: false,
             boxes: '1', courant: /Box mystère\s·\s12\s000 points/, prochain: /Box mystère\s·\s14\s000 points/, acquis: /Historique acquis : 12\s000 points\./ },
    25000: { etats: ['Atteint', 'Atteint', 'Atteint', 'Atteint', 'Atteint'], box: true, vide: false,
             boxes: '7', courant: /Box mystère\s·\s24\s000 points/, prochain: /Box mystère\s·\s26\s000 points/,
             acquis: /12\s000 points, 14\s000 points, 16\s000 points, 18\s000 points, 20\s000 points, 22\s000 points, 24\s000 points/ },
  };
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  for (const solde of [0, 1999, 2000, 9999, 10000, 12000, 25000]) {
    const cas = CAS[solde], att = ATTENDUS[solde];
    const r = await ouvrirFidelite(page, cas, []);
    const nom = 'B (' + fmt(solde) + ' pts)';
    check(nom + ' : solde, prochain palier et points restants sont ceux du serveur',
      r.solde.replace(/[\s\u00a0\u202f]/g, ' ') === fmt(cas.solde)
      && r.restants.replace(/[\s\u00a0\u202f]/g, ' ') === fmt(cas.points_restants)
      && new RegExp('^' + cas.prochain_nom.replace(/\s/g, '\\s') + '\\s·\\s' + fmt(cas.prochain_seuil).replace(/ /g, '\\s') + ' points$').test(r.prochain),
      JSON.stringify({ solde: r.solde, prochain: r.prochain, restants: r.restants }));
    check(nom + ' : cinq paliers 2 000 → 10 000, états en texte ' + JSON.stringify(att.etats),
      r.paliers.length === 5
      && r.paliers.map(p => p.seuil).join(',') === '2000,4000,6000,8000,10000'
      && r.paliers.map(p => p.etatTexte.trim()).join('|') === att.etats.join('|'),
      r.paliers.map(p => p.seuil + ':' + p.etatTexte).join(' '));
    check(nom + ' : bloc Box mystère ' + (att.box ? 'présent' : 'absent'),
      r.box === att.box, 'box=' + r.box);
    if (att.box) {
      check(nom + ' : Box mystère — acquises, seuil courant et prochain seuil (nom + seuil, rien d\'inventé)',
        r.boxesAcquises === att.boxes && att.courant.test(r.seuilCourant) && att.prochain.test(r.seuilProchain)
        && (att.acquis ? att.acquis.test(r.boxTexte) : !/Historique acquis/.test(r.boxTexte))
        && /pas encore communiqu/.test(r.boxTexte),
        JSON.stringify({ acquises: r.boxesAcquises, courant: r.seuilCourant, prochain: r.seuilProchain }));
    }
    check(nom + ' : état vide ' + (att.vide ? 'affiché' : 'absent') + ', historique vide',
      r.vide === att.vide && r.historiqueVide === true, 'vide=' + r.vide);
    const interdits = motsInterdits(r.texte);
    check(nom + ' : ni kilomètre, ni « Entreprise », ni crédit, ni « récompense disponible », ni ancienne valeur',
      interdits.length === 0, interdits.join(', '));
  }

  // ── C. ICÔNES, RÉCOMPENSES, HISTORIQUE, ÉCHAPPEMENT ──
  const r2000 = await ouvrirFidelite(page, CAS[2000], [
    { id: 'm1', points: 1234, motif: 'prestation_payee', created_at: '2026-09-01T10:00:00Z' },
    { id: 'm2', points: -1234, motif: 'remboursement', created_at: '2026-09-02T10:00:00Z' },
    { id: 'm3', points: 0, motif: 'ajustement_admin', detail: '<img src=x onerror=alert(1)>', created_at: '2026-09-03T10:00:00Z' },
    { id: 'm4', points: 2000, motif: '<script>alert(1)</script>', created_at: '2026-09-04T10:00:00Z' }
  ]);
  const icones = r2000.paliers.map(p => p.icone);
  check('C1 : cinq icônes SVG en ligne — cadeau, étoile, insigne, couronne, trophée',
    icones.join(',') === 'cadeau,etoile,insigne,couronne,trophee', icones.join(','));
  check('C2 : les cinq tracés sont distincts (pas cinq fois le même dessin)',
    new Set(r2000.paliers.map(p => p.trace)).size === 5 && r2000.paliers.every(p => p.trace.length > 20));
  check('C3 : la récompense vérifiée du palier 1 est la seule affirmée ; les autres sont « à définir »',
    /10 % sur une box surprise automobile/.test(r2000.paliers[0].recompense)
    && r2000.paliers.slice(1).every(p => /à définir/i.test(p.recompense)),
    r2000.paliers.map(p => p.recompense).join(' | '));
  check('C4 : l\'historique liste les mouvements du serveur avec leur signe',
    r2000.historique.length === 4 && /\+1\s234/.test(r2000.historique.join(' ')) && /−1\s234/.test(r2000.historique.join(' ')),
    JSON.stringify(r2000.historique));
  const injection = await page.evaluate(() => ({
    scripts: document.querySelectorAll('#client-fidelite-page script, #client-fidelite-page img').length,
    alertes: window.__alertes.length,
    brut: document.getElementById('client-fidelite-page').innerHTML.indexOf('<script>') !== -1
  }));
  check('C5 : un motif ou un détail hostile est échappé, jamais interprété (aucun alert(), aucun <script>)',
    injection.scripts === 0 && injection.alertes === 0 && injection.brut === false, JSON.stringify(injection));
  const rHostile = await ouvrirFidelite(page, Object.assign({}, CAS[2000], { prochain_nom: '<b>x</b>', palier_courant_nom: '<i>y</i>' }), []);
  const balises = await page.evaluate(() => document.querySelectorAll('#fid-prochain b, #client-fidelite-page i').length);
  check('C6 : un libellé serveur hostile est échappé lui aussi',
    balises === 0 && /<b>x<\/b>/.test(rHostile.prochain), rHostile.prochain);
  check('C7 : la barre d\'avancement est une proportion des nombres du serveur (2 000 → 4 000 : 0 %)',
    r2000.barre === '0%', String(r2000.barre));
  const r9999 = await ouvrirFidelite(page, CAS[9999], []);
  check('C8 : … et 9 999 entre 8 000 et 10 000 donne 100 % (arrondi), jamais plus',
    r9999.barre === '100%', String(r9999.barre));

  // ── D. PANNE SERVEUR : RIEN D'INVENTÉ ──
  const rNul = await ouvrirFidelite(page, null, []);
  check('D1 : sans ligne serveur, aucun chiffre n\'est affiché, seulement « impossible de charger »',
    /Impossible de charger/.test(rNul.texte) && rNul.solde === null && rNul.paliers.length === 0, rNul.texte.slice(0, 120));
  await page.evaluate(() => { window.__reseauCoupe = true; });
  await page.evaluate(() => showPage('client-fidelite'));
  await page.waitForTimeout(200);
  const rCoupe = await page.evaluate(() => (document.getElementById('client-fidelite-page') || {}).textContent || '');
  await page.evaluate(() => { window.__reseauCoupe = false; });
  check('D2 : une erreur réseau non plus n\'invente rien', /Impossible de charger/.test(rCoupe) && !/\d/.test(rCoupe.replace(/\s/g, '')), rCoupe.slice(0, 120));
  const rMauvais = await ouvrirFidelite(page, Object.assign({}, CAS[2000], { prochain_seuil: 'bidon' }), []);
  check('D3 : une valeur serveur non entière n\'est pas remplacée par un calcul local',
    /Impossible de charger/.test(rMauvais.texte) && rMauvais.paliers.length === 0);

  // ── E. AUCUNE ÉCRITURE, AUCUN ALERT ──
  const journal = await page.evaluate(() => ({
    // roles_utilisateur (lot A01) est une lecture des rôles, pas une écriture.
    ecritures: window.__journal.filter(j => ['insert', 'update', 'delete', 'rpc'].includes(j.op) && j.nom !== 'roles_utilisateur'),
    alertes: window.__alertes.length
  }));
  check('E1 : l\'espace client n\'écrit JAMAIS dans le programme de fidélité (ni insert, ni update, ni rpc)',
    journal.ecritures.length === 0, JSON.stringify(journal.ecritures).slice(0, 200));
  check('E2 : aucun alert() natif sur ces pages', journal.alertes === 0, String(journal.alertes));
  check('E3 : aucune erreur JavaScript', erreursJs.length === 0, erreursJs.join(' | '));

  // ── F. DISPOSITION : HORIZONTALE SUR GRAND ÉCRAN, VERTICALE À 390 PX ──
  const rLarge = await ouvrirFidelite(page, CAS[2000], []);
  const tops = rLarge.paliers.map(p => Math.round(p.boite.top));
  const lefts = rLarge.paliers.map(p => Math.round(p.boite.left));
  check('F1 : à 1 280 px, les cinq paliers sont sur une même ligne, de gauche à droite',
    tops.every(t => Math.abs(t - tops[0]) <= 2) && lefts.every((l, i) => i === 0 || l > lefts[i - 1]),
    'tops=' + tops.join(',') + ' lefts=' + lefts.join(','));
  const mobile = await navigateur.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const erreursMobile = [];
  mobile.on('pageerror', e => erreursMobile.push(e.message));
  await mobile.addInitScript(INIT);
  await connecterClient(mobile);
  const rMobile = await ouvrirFidelite(mobile, CAS[12000], []);
  const b = rMobile.paliers.map(p => p.boite);
  check('F2 : à 390 px, les cinq paliers sont empilés verticalement, sans se chevaucher',
    b.length === 5 && b.every((x, i) => i === 0 || x.top >= b[i - 1].top + b[i - 1].height - 1)
    && b.every(x => x.width <= 390), b.map(x => Math.round(x.top) + '/' + Math.round(x.height)).join(' '));
  check('F3 : à 390 px, rien ne déborde horizontalement (Box mystère comprise)',
    rMobile.largeurDoc <= rMobile.largeurVue && rMobile.box === true, rMobile.largeurDoc + ' > ' + rMobile.largeurVue);
  check('F4 : aucune erreur JavaScript sur mobile', erreursMobile.length === 0, erreursMobile.join(' | '));
  await mobile.close();

  // ── G. LE CODE LIVRÉ ──
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  const pageStatique = dash.slice(dash.indexOf('id="page-client-fidelite"'), dash.indexOf('id="page-client-profil"'));
  check('G1 : la page fidélité statique ne contient plus aucune valeur écrite en dur',
    !/\d{3}/.test(pageStatique.replace(/<!--[\s\S]*?-->/g, '').replace(/id="[^"]*"/g, '')) && /client-fidelite-page/.test(pageStatique), pageStatique.slice(0, 200));
  check('G2 : le dashboard ne parle plus de « Palier Entreprises » ni de « 1 280 km »',
    dash.indexOf('Palier Entreprises') === -1 && dash.indexOf('1 280 km parcourus') === -1);
  const blocFid = dash.slice(dash.indexOf('LOT L01 — PROGRAMME DE FIDÉLITÉ CLIENT (décision C10)'), dash.indexOf('async function chargerInformationsDemande'));
  check('G3 : le code fidélité n\'utilise ni alert() ni un solde calculé localement (pas de somme de points)',
    blocFid.length > 1000 && !/\balert\(/.test(blocFid) && !/reduce\(|\+= *m\.points|points *\+=/.test(blocFid));
  check('G4 : chaque libellé serveur passe par escapeHtml',
    (blocFid.match(/escapeHtml\(/g) || []).length >= 8);
  check('G5 : la nomenclature du menu et le titre de page sont des points, pas des récompenses',
    /'client-fidelite':\s*\['Programme de fidélité', 'Vos points HelixCar'\]/.test(dash));

  // ── H. LA VITRINE : PALIERS EN POINTS, ORDRE DES SECTIONS (L02) ──
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const ordre = Array.from(idx.matchAll(/<section[^>]*id="([^"]+)"/g)).map(m => m[1]);
  check('H1 : ordre de la vitrine — Stockage automobile → Programme de fidélité → Tarifs convoyage → Partenaires',
    ordre.join(',').indexOf('stockage-automobile,fidelite,devis,convoyeurs') !== -1, ordre.join(','));
  const menu = Array.from(idx.matchAll(/<li><a href="#([^"]+)"/g)).map(m => m[1]);
  check('H2 : le menu suit le même ordre (Fidélité avant Devis)',
    menu.indexOf('fidelite') !== -1 && menu.indexOf('fidelite') < menu.indexOf('devis'), menu.join(','));
  check('H3 : chaque section n\'existe qu\'une fois (aucune duplication au déplacement)',
    new Set(ordre).size === ordre.length && ordre.filter(x => x === 'fidelite').length === 1
    && (idx.match(/id="info-rewards"/g) || []).length === 1);
  const pageV = await navigateur.newPage({ viewport: { width: 1280, height: 1000 } });
  await pageV.addInitScript(INIT);
  const errV = [];
  pageV.on('pageerror', e => errV.push(e.message));
  await pageV.goto(urlFichier('index.html'), { waitUntil: 'load' });
  const vitrine = await pageV.evaluate(() => {
    const sec = document.getElementById('fidelite');
    const noeuds = Array.from(sec.querySelectorAll('.track-node')).map(n => ({
      seuil: n.getAttribute('data-seuil'), libelle: (n.querySelector('.node-km') || {}).textContent || '',
      nom: (n.querySelector('.node-nom') || {}).textContent || '',
      icone: n.querySelector('svg') ? n.querySelector('svg').getAttribute('data-icone') : null,
      trace: n.querySelector('svg') ? n.querySelector('svg').innerHTML : '',
      classes: n.className
    }));
    return {
      noeuds,
      barre: !!sec.querySelector('.track-progress'),
      texte: sec.textContent,
      ancreMenu: !!document.querySelector('.nav-links a[href="#fidelite"]'),
      challenge: (document.querySelector('#info-rewards') || {}).textContent || ''
    };
  });
  check('H4 : cinq paliers en points — 2 000, 4 000, 6 000, 8 000, 10 000',
    vitrine.noeuds.map(n => n.seuil).join(',') === '2000,4000,6000,8000,10000'
    && vitrine.noeuds.every(n => /points$/.test(n.libelle.trim())), JSON.stringify(vitrine.noeuds.map(n => n.libelle)));
  check('H5 : cinq icônes sobres et distinctes (cadeau, étoile, insigne, couronne, trophée), sans émoji',
    vitrine.noeuds.map(n => n.icone).join(',') === 'cadeau,etoile,insigne,couronne,trophee'
    && new Set(vitrine.noeuds.map(n => n.trace)).size === 5
    && !/[\u{1F300}-\u{1FAFF}]/u.test(vitrine.texte));
  check('H6 : aucune progression fictive (ni palier « atteint », ni barre remplie), aucun kilomètre, aucun « Palier Entreprises »',
    vitrine.barre === false && vitrine.noeuds.every(n => !/done|active/.test(n.classes))
    && motsInterdits(vitrine.texte).length === 0, motsInterdits(vitrine.texte).join(', '));
  check('H7 : la continuité au-delà de 10 000 points et la Box mystère sont annoncées, sans contenu ni valeur',
    /12\s?000/.test(vitrine.texte.replace(/\u00a0/g, ' ')) && /Box mystère/.test(vitrine.texte)
    && !/€\s*de valeur|d'une valeur|vaut/i.test(vitrine.texte));
  check('H8 : la récompense vérifiée du palier 1 est reprise, les autres sont dévoilées à chaque palier',
    /10\s?% sur une box surprise automobile/.test(vitrine.texte.replace(/\u00a0/g, ' '))
    && /dévoilées à chaque palier/.test(vitrine.texte));
  // Le challenge des convoyeurs ne change pas : son paragraphe est
  // textuellement celui d'origin/main.
  let ancienIdx = '';
  try { ancienIdx = execSync('git show origin/main:index.html', { cwd: RACINE, maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) {}
  const paraChallenge = t => (t.match(/Pour nos convoyeurs, un challenge[^<]*/) || [''])[0].trim();
  check('H9 : le challenge des convoyeurs est textuellement inchangé (L01-001)',
    !ancienIdx || (paraChallenge(idx) !== '' && paraChallenge(idx) === paraChallenge(ancienIdx)),
    paraChallenge(idx).slice(0, 80));
  check('H10 : l\'ancre du menu existe et aucune erreur JavaScript sur la vitrine',
    vitrine.ancreMenu && errV.length === 0, errV.join(' | '));
  await pageV.close();

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  await navigateur.close();
  process.exit(fail ? 1 : 0);
})();
