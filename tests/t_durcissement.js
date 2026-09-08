// DURCISSEMENT DU DASHBOARD — audit indépendant
// ------------------------------------------------------------------
// Trois défauts que les suites existantes ne voyaient pas :
//
//   1. _compterLignes() envoyait la clé ANONYME en Authorization, au
//      lieu du jeton de la session administrateur. Après le
//      durcissement RLS, les compteurs afficheraient zéro — en HTTP
//      200, donc sans la moindre erreur visible.
//   2. Des valeurs de base finissaient dans du innerHTML sans
//      échappement : un nom de client, une plaque, une URL, une
//      référence de mission placée dans un attribut onclick.
//   3. Une photo envoyée dans Storage restait orpheline quand
//      l'écriture de sa trace en base échouait juste après.
//
// Tout est vérifié sur la VRAIE page, avec des données hostiles.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');
const fs = require('fs');


let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 240) + ']' : '')); fail++; echecs.push(l); }
}

// Charges hostiles. Elles ne « ressemblent » pas à une attaque : ce
// sont de vraies charges, qui s'exécutent si l'échappement manque.
const XSS_IMG   = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const XSS_REF   = "HC'-alert(window.__xss=(window.__xss||0)+1)-'";
const XSS_URL   = 'javascript:window.__xss=(window.__xss||0)+1';

const INIT = `
window.__xss = 0;
window.__requetes = [];
window.__trace = [];
window.__insertEchoue = false;
window.__uploadEchoue = false;
window.__db = {
  convoyeurs: [
    {id:'c1',prenom:${JSON.stringify(XSS_IMG)},nom:'TEST-QA',email:'c1@example.invalid',statut:'actif',created_at:'2026-09-01T10:00:00Z'}
  ],
  clients: [
    {id:'k1',numero_client:'HC-QA-1',prenom:${JSON.stringify(XSS_IMG)},nom:'TEST-QA',email:'k1@example.invalid',statut:'nouveau',created_at:'2026-09-06T10:00:00Z',auth_user_id:'u1'}
  ],
  missions: [
    {id:'m1',reference:${JSON.stringify(XSS_REF)},ville_depart:'Paris',ville_arrivee:'Lyon',
     client_id:'k1',convoyeur_id:'c1',
     marque_modele:${JSON.stringify(XSS_IMG)},immatriculation:'QA-111-QA',
     date_prise_en_charge:'2026-10-01',prix_ttc:400,statut:'fini',type_mission:'convoyage',
     lettre_voiture_signee_url:${JSON.stringify(XSS_URL)}},
    {id:'m2',reference:'HC-QA-NET',client_id:'k1',convoyeur_id:'c1',statut:'fini',
     type_mission:'nettoyage',prestation:${JSON.stringify(XSS_IMG)},
     adresse_intervention:${JSON.stringify(XSS_IMG)},ville_intervention:'Lyon',
     date_intervention:'2026-10-02',prix_ttc:300}
  ],
  devis: [], mission_photos: []
};
window.__emails = [];
window.emailjs = { init:function(){}, send:function(){ window.__emails.push(1); return Promise.resolve(); },
                   sendForm:function(){ window.__emails.push(1); return Promise.resolve(); } };
window.__alertes = [];
window.alert = function(m){ window.__alertes.push(String(m)); };
window.confirm = function(){ return true; };

// Session ADMIN réelle : c'est elle que _compterLignes() doit utiliser.
window.__jetonAdmin = 'jwt-admin-de-test';
window.supabase = { createClient: function(){ return {
  auth: { onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
          getSession: async function(){ return { data:{ session:{ access_token: window.__jetonAdmin } } }; } },
  // sbAuth est declare const dans la page : impossible de le remplacer
  // depuis le test. Le double est donc pilotable par deux drapeaux, que
  // la section E bascule au moment voulu.
  from: function(){ return {
    select(){return this;}, eq(){return this;}, order(){return this;},
    limit(){return this;}, update(){return this;},
    insert: async function(){
      window.__trace.push({ op: 'insert' });
      return window.__insertEchoue ? { error: { message: 'refus RLS simulé' } } : { error: null };
    },
    then(r){ return Promise.resolve({data:[],error:null}).then(r); } }; },
  storage: { from: function(b){ return {
    upload: async function(chemin){
      window.__trace.push({ op: 'upload', bucket: b, chemin: chemin });
      return window.__uploadEchoue
        ? { data: null, error: { message: 'envoi refusé' } }
        : { data: { path: chemin }, error: null };
    },
    remove: async function(chemins){
      window.__trace.push({ op: 'remove', bucket: b, chemins: chemins });
      return { data: null, error: null };
    },
    createSignedUrl: async function(){ return { data: null, error: { message: 'non testé ici' } }; },
    createSignedUrls: async function(c){ return { data: c.map(x => ({ path: x, signedUrl: 'https://exemple.invalid/' + x })), error: null }; }
  }; } } }; } };

const _f = window.fetch;
window.fetch = function(u, o){
  u = String(u);
  const i = u.indexOf('/rest/v1/');
  if (i === -1) return _f.apply(window, arguments);
  // On enregistre les EN-TÊTES RÉELLEMENT ENVOYÉS : c'est le seul moyen
  // de prouver quelle autorisation part sur le réseau.
  const h = ((o || {}).headers) || {};
  window.__requetes.push({
    url: u,
    authorization: h['Authorization'] || h['authorization'] || null,
    apikey: h['apikey'] || null,
    prefer: h['Prefer'] || h['prefer'] || null
  });
  const req = u.slice(i + 9);
  const chemin = req.split('?')[0];
  const params = new URLSearchParams(req.split('?')[1] || '');
  let lignes = (window.__db[chemin] || []).slice();
  params.forEach(function(v, k){
    if (['select','order','limit','offset'].indexOf(k) !== -1 || k.charAt(0) === '$') return;
    if (v.indexOf('eq.') === 0) lignes = lignes.filter(l => String(l[k]) === decodeURIComponent(v.slice(3)));
    else if (v.indexOf('in.(') === 0) {
      const vals = decodeURIComponent(v.slice(4, -1)).split(',');
      lignes = lignes.filter(l => vals.indexOf(String(l[k])) !== -1);
    }
    else if (v === 'not.is.null') lignes = lignes.filter(l => l[k] !== null && l[k] !== undefined);
    else if (v.indexOf('gte.') === 0) lignes = lignes.filter(l => String(l[k]) >= decodeURIComponent(v.slice(4)));
  });
  const total = lignes.length;
  const lim = params.get('limit');
  if (lim === '0') lignes = [];
  else if (lim) lignes = lignes.slice(0, parseInt(lim, 10));
  return Promise.resolve({ ok:true, status:200,
    headers:{ get:(h2)=> h2.toLowerCase()==='content-range' ? ('items 0-' + total + '/' + total) : null },
    text:()=>Promise.resolve(JSON.stringify(lignes)) });
};
`;

(async () => {
  const browser = await lancerNavigateur();
  const src = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await page.evaluate(() => {
    currentRole = 'admin';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (typeof buildNav === 'function') buildNav('admin');
    showPage('admin-dashboard');
  });
  await page.waitForTimeout(900);

  // ══ A. L'AUTORISATION RÉELLEMENT ENVOYÉE PAR LES COMPTEURS ══
  const compteurs = await page.evaluate(() =>
    window.__requetes.filter(r => /limit=0/.test(r.url)));

  check('A1 : les compteurs émettent bien des requêtes de comptage',
    compteurs.length >= 3, 'requêtes limit=0 : ' + compteurs.length);
  check('A2 : chacune demande un comptage exact',
    compteurs.every(r => /count=exact/.test(r.prefer || '')),
    JSON.stringify(compteurs.map(r => r.prefer)));

  // LE contrôle du point 4 : la VALEUR du header, pas sa présence.
  const jeton = await page.evaluate(() => window.__jetonAdmin);
  const cleAnon = await page.evaluate(() => SUPABASE_KEY);
  const avecAnon = compteurs.filter(r => r.authorization === 'Bearer ' + cleAnon);
  const avecJwt  = compteurs.filter(r => r.authorization === 'Bearer ' + jeton);

  check('A3 : AUCUN comptage n\'envoie la clé anonyme en Authorization',
    avecAnon.length === 0,
    avecAnon.length + ' requête(s) : ' + JSON.stringify(avecAnon.map(r => r.url.slice(-60))));
  check('A4 : tous envoient le JWT de la session administrateur',
    avecJwt.length === compteurs.length && compteurs.length > 0,
    avecJwt.length + ' / ' + compteurs.length);
  check('A5 : la clé publique reste en apikey, comme Supabase l\'attend',
    compteurs.every(r => r.apikey === cleAnon),
    JSON.stringify(compteurs.map(r => r.apikey && r.apikey.slice(0, 12))));
  check('A6 : le comptage suit la même règle que sbFetch, sans second système',
    /async function _compterLignes/.test(src)
    && /_compterLignes[\s\S]{0,600}_jetonSessionSupabase\(\)/.test(src));

  const listes = await page.evaluate(() =>
    window.__requetes.filter(r => !/limit=0/.test(r.url)));
  check('A7 : les lectures de listes envoient elles aussi le JWT',
    listes.length > 0 && listes.every(r => r.authorization === 'Bearer ' + jeton),
    JSON.stringify(listes.slice(0, 2).map(r => r.authorization)));

  // ══ B. INJECTION HTML / JAVASCRIPT ══
  await page.evaluate(() => showPage('admin-missions'));
  await page.waitForTimeout(800);

  const vue = await page.evaluate(() => {
    const t = document.getElementById('missions-table');
    return {
      xss: window.__xss,
      html: t ? t.innerHTML : '',
      texte: t ? t.textContent : '',
      imgs: t ? t.querySelectorAll('img').length : -1,
      liensJs: t ? Array.from(t.querySelectorAll('a'))
        .filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length : -1,
      hrefs: t ? Array.from(t.querySelectorAll('a')).map(a => a.getAttribute('href')) : []
    };
  });

  check('B1 : la charge hostile n\'a PAS été exécutée', vue.xss === 0, 'window.__xss = ' + vue.xss);
  check('B2 : aucune balise <img> injectée n\'a été créée', vue.imgs === 0, String(vue.imgs));
  check('B3 : la charge apparaît comme du TEXTE, pas comme du balisage',
    vue.texte.indexOf('<img') !== -1, vue.texte.slice(0, 120));
  check('B4 : aucun lien javascript: n\'est posé dans la page',
    vue.liensJs === 0, JSON.stringify(vue.hrefs));
  check('B5 : l\'URL hostile est écartée, pas seulement échappée',
    vue.hrefs.every(h => !/javascript:/i.test(h || '')), JSON.stringify(vue.hrefs));

  // L'apostrophe de la référence ne doit pas casser l'attribut onclick.
  const boutons = await page.evaluate(() => {
    const t = document.getElementById('missions-table');
    return Array.from(t.querySelectorAll('button'))
      .map(b => b.getAttribute('onclick') || '').filter(Boolean);
  });
  check('B6 : les attributs onclick sont syntaxiquement valides',
    boutons.every(o => { try { new Function(o); return true; } catch (e) { return false; } }),
    boutons.slice(0, 2).join(' || '));
  check('B7 : aucune erreur JavaScript pendant le rendu hostile',
    errs.length === 0, errs.slice(0, 3).join(' | '));

  // Le clic réel : c'est là que la fuite se produirait.
  await page.evaluate(() => {
    const t = document.getElementById('missions-table');
    const b = Array.from(t.querySelectorAll('button'))
      .filter(x => /Photos/.test(x.textContent))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  check('B8 : cliquer un bouton dont la référence est hostile n\'exécute rien',
    await page.evaluate(() => window.__xss) === 0);

  // ══ C. LES TROIS ÉCHAPPEMENTS, UN PAR CONTEXTE ══
  const helpers = await page.evaluate(() => ({
    aJs: typeof escapeJsAttr === 'function',
    aUrl: typeof urlSure === 'function',
    // escapeHtml SEUL ne suffit pas dans une chaîne JS : le navigateur
    // décode l'attribut AVANT que JavaScript ne le lise.
    htmlSeul: escapeHtml("a'b"),
    jsAttr: escapeJsAttr("a'b"),
    jsBackslash: escapeJsAttr('a\\b'),
    jsBalise: escapeJsAttr('</scr' + 'ipt>'),
    urlHttp: urlSure('https://exemple.invalid/a.pdf'),
    urlRelative: urlSure('/fichier.pdf'),
    urlJs: urlSure('javascript:alert(1)'),
    urlData: urlSure('data:text/html,<script>1</scr' + 'ipt>'),
    urlVbs: urlSure('VBScript:msgbox(1)'),
    urlEspaces: urlSure('   javascript:alert(1)')
  }));
  check('C1 : un échappement dédié aux chaînes JavaScript existe', helpers.aJs);
  check('C2 : et un filtre d\'URL aussi', helpers.aUrl);
  check('C3 : escapeHtml seul laisse une apostrophe exploitable',
    helpers.htmlSeul === 'a&#39;b', helpers.htmlSeul);
  check('C4 : escapeJsAttr échappe l\'apostrophe POUR JavaScript d\'abord',
    helpers.jsAttr === 'a\\&#39;b', helpers.jsAttr);
  check('C5 : il échappe aussi l\'antislash', /\\\\/.test(helpers.jsBackslash), helpers.jsBackslash);
  check('C6 : et neutralise une balise de fermeture',
    helpers.jsBalise.indexOf('<') === -1, helpers.jsBalise);
  check('C7 : urlSure accepte http(s)', helpers.urlHttp === 'https://exemple.invalid/a.pdf');
  check('C8 : urlSure accepte un chemin interne', helpers.urlRelative === '/fichier.pdf');
  check('C9 : urlSure rejette javascript:', helpers.urlJs === '', helpers.urlJs);
  check('C10 : urlSure rejette data:', helpers.urlData === '', helpers.urlData);
  check('C11 : urlSure rejette VBScript:', helpers.urlVbs === '', helpers.urlVbs);
  check('C12 : urlSure n\'est pas trompée par des espaces de tête',
    helpers.urlEspaces === '', helpers.urlEspaces);

  // ══ D. AUCUN href DE BASE N'EST POSÉ SANS FILTRE ══
  const hrefsBruts = (src.match(/href="'\s*\+\s*[A-Za-z_$][\w$.]*/g) || [])
    .filter(x => !/escapeHtml|urlSure/.test(x));
  check('D1 : plus aucun href construit directement sur une valeur de base',
    hrefsBruts.length === 0, hrefsBruts.join(' | '));
  check('D2 : les liens ouverts dans un onglet portent rel="noopener"',
    (src.match(/target="_blank"/g) || []).length
      === (src.match(/target="_blank" rel="noopener/g) || []).length,
    'target=_blank sans rel : '
      + ((src.match(/target="_blank"/g) || []).length
         - (src.match(/target="_blank" rel="noopener/g) || []).length));

  // ══ E. PHOTOS : PAS D'ORPHELIN DANS LE BUCKET ══
  check('E1 : l\'envoi d\'une photo prévoit le retrait du fichier en cas d\'échec',
    /deposeFaite[\s\S]{0,900}storage\.from\('missions-photos'\)\.remove/.test(src));
  check('E2 : le ménage ne se déclenche QUE si le fichier est réellement parti',
    /if \(deposeFaite\) \{/.test(src));
  check('E3 : et il ne masque jamais l\'erreur d\'origine',
    /orphelin non supprimé/.test(src) && /alert\('La photo n\\'a pas pu être envoyée/.test(src));

  // Épreuve réelle : Storage accepte, la base refuse.
  const menage = await page.evaluate(async () => {
    window.__trace = [];
    window.__insertEchoue = true;
    const champ = document.createElement('input');
    champ.type = 'file';
    champ.setAttribute('data-mission', 'm2');
    champ.setAttribute('data-etape', 'avant');
    const f = new File([new Uint8Array([255, 216, 255, 224])], 'a.jpg', { type: 'image/jpeg' });
    Object.defineProperty(champ, 'files', { value: [f], configurable: true });
    await envoyerPhotoMission(champ);
    return window.__trace.slice();
  });
  check('E4 : le fichier est bien parti dans le bucket',
    menage.some(t => t.op === 'upload' && t.bucket === 'missions-photos'), JSON.stringify(menage));
  check('E5 : l\'insertion en base ayant échoué, le fichier est SUPPRIMÉ',
    menage.some(t => t.op === 'remove' && t.bucket === 'missions-photos'), JSON.stringify(menage));
  check('E6 : et c\'est exactement le fichier qui venait d\'être envoyé',
    (function () {
      const up = menage.find(t => t.op === 'upload');
      const rm = menage.find(t => t.op === 'remove');
      return up && rm && rm.chemins.length === 1 && rm.chemins[0] === up.chemin;
    })(), JSON.stringify(menage));
  check('E6b : le chemin visé désigne bien CETTE mission, et elle seule',
    (menage.find(t => t.op === 'upload') || {}).chemin
      && (menage.find(t => t.op === 'upload')).chemin.indexOf('missions/m2/') === 0,
    JSON.stringify(menage));

  // Le cas nominal ne doit RIEN supprimer.
  const nominal = await page.evaluate(async () => {
    window.__trace = [];
    window.__insertEchoue = false;
    const champ = document.createElement('input');
    champ.type = 'file';
    champ.setAttribute('data-mission', 'm2');
    champ.setAttribute('data-etape', 'apres');
    const f = new File([new Uint8Array([255, 216, 255, 224])], 'b.jpg', { type: 'image/jpeg' });
    Object.defineProperty(champ, 'files', { value: [f], configurable: true });
    await envoyerPhotoMission(champ);
    return window.__trace.slice();
  });
  check('E7 : quand tout réussit, RIEN n\'est supprimé',
    nominal.some(t => t.op === 'upload') && !nominal.some(t => t.op === 'remove'),
    JSON.stringify(nominal));

  // Envoi refusé d'emblée : il n'y a rien à défaire, et rien ne doit
  // être supprimé « au cas où ».
  const refusEnvoi = await page.evaluate(async () => {
    window.__trace = [];
    window.__uploadEchoue = true;
    const champ = document.createElement('input');
    champ.type = 'file';
    champ.setAttribute('data-mission', 'm2');
    champ.setAttribute('data-etape', 'avant');
    const f = new File([new Uint8Array([255, 216, 255, 224])], 'c.jpg', { type: 'image/jpeg' });
    Object.defineProperty(champ, 'files', { value: [f], configurable: true });
    await envoyerPhotoMission(champ);
    window.__uploadEchoue = false;
    return window.__trace.slice();
  });
  check('E8 : si l\'envoi échoue d\'emblée, aucune suppression n\'est tentée',
    !refusEnvoi.some(t => t.op === 'remove'), JSON.stringify(refusEnvoi));
  check('E9 : et aucune trace n\'est écrite en base',
    !refusEnvoi.some(t => t.op === 'insert'), JSON.stringify(refusEnvoi));

  // ══ F. LA VALIDATION S'APPUIE SUR LE SERVEUR ══
  check('F1 : le navigateur ne déclare plus lui-même le validateur',
    !/prestation_validee_par:\s*[^,\n}]*(auth|user|conv)/i.test(src)
    || /prestation_validee_par := v_uid/.test(fs.readFileSync(fichier('migrations/97_missions_verrou_serveur.sql'), 'utf8')));
  check('F2 : un refus serveur pour photos manquantes est expliqué au lieu d\'être brut',
    /non constatée\|photo/.test(src) || /non constatée/.test(src));
  const mig97 = fs.readFileSync(fichier('migrations/97_missions_verrou_serveur.sql'), 'utf8');
  check('F3 : le contrôle des photos existe côté serveur, pas seulement dans l\'écran',
    /mission_photos_completes/.test(mig97) && /statut = 'terminee'/.test(mig97));
  check('F4 : et il s\'applique aussi à l\'administrateur',
    /Règles qui valent AUSSI pour l'administrateur/.test(mig97));

  check('Z1 : aucun e-mail envoyé pendant tout ce parcours',
    await page.evaluate(() => window.__emails.length) === 0);

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
