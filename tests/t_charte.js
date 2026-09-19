// CHARTE HELIXCAR DANS LE DASHBOARD, FOND BLANC (§11)
// ------------------------------------------------------------------
// Vérifie sur le VRAI Dashboard, rendu dans Chromium, que la charte du
// site public est réellement appliquée et que le fond est blanc — pas
// seulement que le fichier contient les bonnes chaînes.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 200) + ']' : '')); fail++; echecs.push(l); }
}

const INIT = `
window.supabase = { createClient: function(){ return {
  auth: { onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
          getSession: async function(){ return { data:{ session:null } }; } },
  from: function(){ return { select(){return this;}, eq(){return this;}, order(){return this;},
                              limit(){return this;}, then(r){ return Promise.resolve({data:[],error:null}).then(r); } }; },
  storage: { from: function(){ return {}; } } }; } };
const _f = window.fetch;
window.fetch = function(u){ if(String(u).indexOf('/rest/v1/')!==-1)
  return Promise.resolve({ok:true,status:200,headers:{get:()=> 'items 0-0/0'},text:()=>Promise.resolve('[]')});
  return _f.apply(window, arguments); };
`;

// Palette de référence, lue sur le site public : aucune valeur inventée.
function paletteDuSite() {
  const src = fs.readFileSync(fichier('index.html'), 'utf8');
  const bloc = src.slice(src.indexOf(':root'), src.indexOf(':root') + 1600);
  const lire = nom => {
    const m = new RegExp('--' + nom + ':\\s*([^;]+);').exec(bloc);
    return m ? m[1].trim() : null;
  };
  return { ink: lire('ink'), paper: lire('paper'), silver: lire('silver'),
           accent: lire('accent'), accentLight: lire('accent-light'), charcoal: lire('charcoal') };
}

(async () => {
  const REF = paletteDuSite();
  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return { ink: v('--ink'), paper: v('--paper'), silver: v('--silver'), accent: v('--accent'),
             accentLight: v('--accent-light'), charcoal: v('--charcoal'), white: v('--white') };
  });

  // ── A. LA PALETTE EST CELLE DU SITE, À LA VIRGULE PRÈS ──
  check('A1 : --accent est le rouge HelixCar du site',
    vars.accent.toUpperCase() === (REF.accent || '').toUpperCase(), vars.accent + ' vs ' + REF.accent);
  check('A2 : --ink est le bleu nuit du site',
    vars.ink.toUpperCase() === (REF.ink || '').toUpperCase(), vars.ink + ' vs ' + REF.ink);
  check('A3 : --charcoal est l\'anthracite du site',
    vars.charcoal.toUpperCase() === (REF.charcoal || '').toUpperCase(), vars.charcoal + ' vs ' + REF.charcoal);
  check('A4 : --silver est le gris argent du site',
    vars.silver.toUpperCase() === (REF.silver || '').toUpperCase(), vars.silver + ' vs ' + REF.silver);
  check('A5 : --accent-light suit', vars.accentLight.toUpperCase() === (REF.accentLight || '').toUpperCase(),
    vars.accentLight + ' vs ' + REF.accentLight);

  // ── B. FOND BLANC — EXIGENCE EXPLICITE ──
  const fond = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    html: getComputedStyle(document.documentElement).backgroundColor,
    blanc: getComputedStyle(document.documentElement).getPropertyValue('--white').trim(),
  }));
  check('B1 : le fond de page est blanc', fond.body === 'rgb(255, 255, 255)', fond.body);
  check('B2 : --white est le blanc pur, plus l\'ivoire #FAFAF7',
    fond.blanc.toUpperCase() === '#FFFFFF', fond.blanc);
  check('B3 : plus aucune trace du fond beige #F4F3EE dans une règle',
    !/background:\s*#F4F3EE/i.test(fs.readFileSync(fichier('dashboard.html'), 'utf8')));

  // ── C. LES COMPOSANTS RESTENT LISIBLES SUR BLANC ──
  await page.evaluate(() => {
    currentRole = 'admin';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (typeof buildNav === 'function') buildNav('admin');
    showPage('admin-dashboard');
  });
  await page.waitForTimeout(400);
  const composants = await page.evaluate(() => {
    const carte = document.querySelector('.card');
    const stat = document.querySelector('.stat-card');
    const barre = document.querySelector('.sidebar');
    const cs = e => e ? getComputedStyle(e) : null;
    const c = cs(carte), s = cs(stat), b = cs(barre);
    return {
      carteFond: c && c.backgroundColor, carteBordure: c && c.borderTopWidth,
      statFond: s && s.backgroundColor, statBordure: s && s.borderTopWidth,
      barreFond: b && b.backgroundColor,
    };
  });
  check('C1 : les cartes sont blanches', composants.carteFond === 'rgb(255, 255, 255)', composants.carteFond);
  check('C2 : et restent délimitées par un filet, jamais par une teinte',
    parseFloat(composants.carteBordure) > 0, composants.carteBordure);
  check('C3 : les cartes de chiffres aussi',
    composants.statFond === 'rgb(255, 255, 255)' && parseFloat(composants.statBordure) > 0,
    JSON.stringify(composants));
  check('C4 : la barre latérale prend le bleu nuit HelixCar, plus le marine #0A1628',
    composants.barreFond === 'rgb(16, 24, 32)', composants.barreFond);

  // ── D. TYPOGRAPHIE DU SITE ──
  const polices = await page.evaluate(() => ({
    corps: getComputedStyle(document.body).fontFamily,
    titre: getComputedStyle(document.querySelector('.card-title')).fontFamily,
    bouton: getComputedStyle(document.querySelector('.btn')).fontFamily,
  }));
  check('D1 : le texte courant est en Instrument Sans, comme le site',
    /Instrument Sans/.test(polices.corps), polices.corps);
  check('D2 : les titres sont en Fraunces, comme le site',
    /Fraunces/.test(polices.titre), polices.titre);
  check('D3 : les commandes restent en sans-serif (libellés compacts)',
    /Instrument Sans/.test(polices.bouton) && !/Fraunces/.test(polices.bouton), polices.bouton);

  // ── E. AUCUNE COULEUR DE L'ANCIENNE CHARTE NE SUBSISTE ──
  // Les commentaires SQL/CSS sont retirés avant comptage : une couleur
  // citée dans une explication n'est pas une couleur appliquée.
  const src = fs.readFileSync(fichier('dashboard.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const ANCIENNES = {
    '#F5C518': 'jaune', '#FFD94A': 'jaune clair', '#0A1628': 'bleu marine',
    '#1A3A6B': 'bleu', '#2556A8': 'bleu moyen', '#FAFAF7': 'ivoire',
    '#F4F3EE': 'beige', '#EF4444': 'rouge vif', '#22C55E': 'vert vif', '#F97316': 'orange vif',
  };
  Object.keys(ANCIENNES).forEach((hex, i) => {
    const n = (src.match(new RegExp(hex, 'gi')) || []).length;
    check('E' + (i + 1) + ' : plus de ' + ANCIENNES[hex] + ' ' + hex, n === 0, String(n));
  });
  const rgbaAnciens = [
    ['245,197,24', 'jaune'], ['37,86,168', 'bleu'], ['239,68,68', 'rouge vif'],
    ['34,197,94', 'vert vif'], ['249,115,22', 'orange vif'],
  ];
  rgbaAnciens.forEach(([v, nom], i) => {
    const n = (src.match(new RegExp('rgba\\(\\s*' + v.replace(/,/g, '\\s*,\\s*'), 'g') ) || []).length;
    check('E' + (11 + i) + ' : plus de teinte ' + nom + ' rgba(' + v + ')', n === 0, String(n));
  });
  check('E16 : plus aucune référence aux anciennes polices',
    src.indexOf("'Syne'") === -1 && src.indexOf("'DM Sans'") === -1);

  // ── F. LES ÉTATS RESTENT DISTINGUABLES ENTRE EUX ──
  const etats = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { vert: cs.getPropertyValue('--green').trim(), rouge: cs.getPropertyValue('--red').trim(),
             orange: cs.getPropertyValue('--orange').trim() };
  });
  check('F1 : validé, refusé et en attente restent trois couleurs distinctes',
    new Set([etats.vert, etats.rouge, etats.orange]).size === 3, JSON.stringify(etats));
  check('F2 : le rouge d\'état est le rouge HelixCar',
    etats.rouge.toUpperCase() === (REF.accent || '').toUpperCase(), etats.rouge);

  check('Z1 : aucune erreur JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
