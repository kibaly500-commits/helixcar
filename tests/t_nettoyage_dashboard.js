// NETTOYAGE DU DASHBOARD ET DES MISSIONS (§14)
// ------------------------------------------------------------------
// Le Dashboard mélangeait des données réelles et des exemples inventés,
// sans qu'un administrateur puisse les distinguer, et annonçait des
// e-mails et des SMS qui n'étaient jamais envoyés. Un chemin permettait
// même d'entrer sans mot de passe. Ce fichier vérifie chaque correction
// sur la VRAIE page, avec un double Supabase qui renvoie des lignes
// TEST-QA identifiables.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 220) + ']' : '')); fail++; echecs.push(l); }
}

const INIT = `
window.__db = {
  convoyeurs: [
    {id:'c1',prenom:'TEST-QA',nom:'Candidat',email:'c1@example.invalid',statut:'en_attente',created_at:'2026-09-05T10:00:00Z'},
    {id:'c2',prenom:'TEST-QA',nom:'Actif',email:'c2@example.invalid',statut:'actif',created_at:'2026-09-01T10:00:00Z'},
    {id:'c3',prenom:'TEST-QA',nom:'Actif2',email:'c3@example.invalid',statut:'actif',created_at:'2026-08-20T10:00:00Z'}
  ],
  clients: [
    {id:'k1',numero_client:'HC-QA-1',prenom:'TEST-QA',nom:'Client',email:'k1@example.invalid',telephone:'+33600000001',type_client:'particulier',statut:'nouveau',created_at:'2026-09-06T10:00:00Z',auth_user_id:'u1'},
    {id:'k2',numero_client:'HC-QA-2',prenom:'TEST-QA',nom:'Client',email:'k1@example.invalid',telephone:'+33600000001',type_client:'particulier',statut:'nouveau',created_at:'2026-09-07T10:00:00Z',auth_user_id:'u1'},
    {id:'k3',numero_client:'HC-QA-3',prenom:'TEST-QA',nom:'Anonyme',email:'k3@example.invalid',telephone:null,type_client:'pro',statut:'nouveau',created_at:'2026-09-04T10:00:00Z',auth_user_id:null}
  ],
  missions: [
    {id:'m1',reference:'HC-QA-M1',ville_depart:'Paris',ville_arrivee:'Lyon',client_id:'k1',convoyeur_id:'c2',marque_modele:'TEST-QA 208',immatriculation:'QA-111-QA',date_prise_en_charge:'2026-10-01',prix_ttc:400,statut:'en_cours'},
    {id:'m2',reference:'HC-QA-M2',ville_depart:'Lyon',ville_arrivee:'Nice',client_id:'k2',convoyeur_id:null,marque_modele:'TEST-QA C3',immatriculation:'QA-222-QA',date_prise_en_charge:'2026-10-05',prix_ttc:300,statut:'proposee'},
    {id:'m3',reference:'HC-QA-M3',ville_depart:'Nice',ville_arrivee:'Paris',client_id:'k1',convoyeur_id:'c2',marque_modele:'TEST-QA A3',immatriculation:'QA-333-QA',date_prise_en_charge:'2026-08-01',prix_ttc:500,statut:'terminee'}
  ],
  devis: [
    {reference:'DEV-QA-1',prix:400,statut:'accepte',date_generation:'2026-09-02T10:00:00Z'},
    {reference:'DEV-QA-2',prix:250,statut:'accepte',date_generation:'2026-09-03T10:00:00Z'}
  ]
};
window.__emails = [];
window.emailjs = { init:function(){}, send:function(){ window.__emails.push(1); return Promise.resolve(); },
                   sendForm:function(){ window.__emails.push(1); return Promise.resolve(); } };
window.__alertes = [];
const _alertReel = window.alert;
window.alert = function(m){ window.__alertes.push(String(m)); };
window.confirm = function(){ return true; };
window.supabase = { createClient: function(){ return {
  auth: { onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
          getSession: async function(){ return { data:{ session:null } }; } },
  from: function(){ return { select(){return this;}, eq(){return this;}, order(){return this;},
                              limit(){return this;}, then(r){ return Promise.resolve({data:[],error:null}).then(r); } }; },
  storage: { from: function(){ return {}; } } }; } };
const _f = window.fetch;
window.fetch = function(u, o){
  u = String(u);
  const i = u.indexOf('/rest/v1/');
  if (i === -1) return _f.apply(window, arguments);
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
    headers:{ get:(h)=> h.toLowerCase()==='content-range' ? ('items 0-' + total + '/' + total) : null },
    text:()=>Promise.resolve(JSON.stringify(lignes)) });
};
`;

(async () => {
  const browser = await lancerNavigateur();
  const src = fs.readFileSync(fichier('dashboard.html'), 'utf8');

  // ── A. PLUS AUCUN CONTOURNEMENT DE LA CONNEXION ──
  const pageA = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errsA = [];
  pageA.on('pageerror', e => errsA.push(e.message));
  await pageA.addInitScript(INIT + `
    try { localStorage.setItem('helixcar_demo_email', 'client@helixcar.com'); } catch (e) {}
  `);
  await pageA.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await pageA.waitForTimeout(600);
  const apresBypass = await pageA.evaluate(() => ({
    loginVisible: getComputedStyle(document.getElementById('login-screen')).display !== 'none',
    appVisible: document.getElementById('app').classList.contains('visible'),
    cleRestante: (function () { try { return localStorage.getItem('helixcar_demo_email'); } catch (e) { return 'illisible'; } })(),
  }));
  check('A1 : une clé de « session démo » n\'ouvre PLUS l\'interface',
    apresBypass.appVisible === false, JSON.stringify(apresBypass));
  check('A2 : l\'écran d\'attente reste affiché, l\'interface fermée',
    apresBypass.loginVisible === true, JSON.stringify(apresBypass));
  check('A3 : la clé résiduelle est effacée, pas laissée derrière',
    apresBypass.cleRestante === null, String(apresBypass.cleRestante));
  check('A4 : plus aucune table de comptes de démonstration dans le code',
    !/const USERS = \{/.test(src) && src.indexOf("pw: 'demo123'") === -1);
  check('A5 : plus aucun identifiant de démonstration affiché à la connexion',
    src.indexOf('demo123') === -1, 'demo123 encore présent');

  // ── B. L'ACCUEIL AFFICHE DE VRAIES DONNÉES ──
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

  const stats = await page.evaluate(() => ({
    pending: (document.getElementById('stat-pending') || {}).textContent,
    convoyeurs: (document.getElementById('stat-convoyeurs') || {}).textContent,
    clients: (document.getElementById('stat-clients') || {}).textContent,
    missions: (document.getElementById('stat-missions') || {}).textContent,
    ca: (document.getElementById('stat-ca') || {}).textContent,
    caSub: (document.getElementById('stat-ca-sub') || {}).textContent,
  }));
  check('B1 : candidatures en attente — comptées, plus écrites en dur',
    stats.pending === '1', JSON.stringify(stats));
  check('B2 : convoyeurs actifs — comptés', stats.convoyeurs === '2', stats.convoyeurs);
  check('B3 : clients inscrits — seuls les comptes réellement créés',
    stats.clients === '2', stats.clients);
  check('B4 : missions en cours — les statuts actifs seulement, pas les terminées',
    stats.missions === '2', stats.missions);
  check('B5 : le « CA » inventé est remplacé par les devis réellement acceptés',
    stats.ca === '650' && /2 devis/.test(stats.caSub), JSON.stringify(stats));

  const contenu = await page.evaluate(() => ({
    inscriptions: (document.getElementById('inscriptions-recentes') || {}).textContent || '',
    missions: (document.getElementById('missions-accueil') || {}).textContent || '',
    alerte: (document.getElementById('alerte-candidatures') || {}).textContent || '',
  }));
  check('B6 : les dernières inscriptions viennent de la base',
    /TEST-QA Candidat/.test(contenu.inscriptions) && /TEST-QA Client/.test(contenu.inscriptions),
    contenu.inscriptions.slice(0, 150));
  check('B7 : les missions de l\'accueil aussi',
    /HC-QA-M1/.test(contenu.missions), contenu.missions.slice(0, 150));
  check('B8 : la répartition 50/25/25 est calculée sur le vrai prix',
    /400 €/.test(contenu.missions) && /200 €/.test(contenu.missions) && /100 €/.test(contenu.missions),
    contenu.missions.slice(0, 200));
  check('B9 : l\'alerte candidatures compte les vraies candidatures',
    /1 candidature partenaire est en attente/.test(contenu.alerte), contenu.alerte);
  check('B10 : les statuts techniques sont traduits, pas affichés bruts',
    !/en_attente/.test(contenu.inscriptions) && /En attente/.test(contenu.inscriptions),
    contenu.inscriptions.slice(0, 150));

  const badge = await page.evaluate(() => {
    const b = document.getElementById('badge-candidatures');
    return b ? { texte: b.textContent, visible: b.style.display !== 'none' } : null;
  });
  check('B11 : le badge du menu ne dit plus « 3 » quoi qu\'il arrive',
    badge && badge.texte === '1', JSON.stringify(badge));

  // RÈGLE VÉRIFIÉE : plus aucun nom inventé ne peut apparaître dans une
  // page qui ne s'annonce PAS comme une démonstration. Le test regarde
  // le DOM réel, page par page, plutôt que de chercher des chaînes dans
  // le fichier — une mention dans un commentaire n'est pas un affichage.
  const NOMS_INVENTES = ['Karim Benali', 'Sophie Martin', 'Thomas Durand', 'Leila Mansour',
                         'Marc Dupont', 'Sarah Kohen', 'Pierre Moreau', 'AutoFleet SAS',
                         'Antoine Arcelin', 'Jean Pellerin', 'Sara Bouali', 'Nadia Ouali',
                         'Julie Robert', 'Farid Alami', 'Marie Lambert'];
  const fautives = await page.evaluate(noms => {
    const out = [];
    document.querySelectorAll('.page').forEach(p => {
      const txt = p.textContent || '';
      const annonce = txt.indexOf('Page de démonstration') !== -1;
      if (annonce) return;
      noms.forEach(n => { if (txt.indexOf(n) !== -1) out.push(p.id + ' → ' + n); });
    });
    return out;
  }, NOMS_INVENTES);
  check('B12 : aucun nom inventé dans une page qui ne s\'annonce pas comme un exemple',
    fautives.length === 0, fautives.slice(0, 5).join(' | '));

  const pagesDemo = await page.evaluate(noms => {
    const out = [];
    document.querySelectorAll('.page').forEach(p => {
      const txt = p.textContent || '';
      if (noms.some(n => txt.indexOf(n) !== -1)) out.push(p.id);
    });
    return out;
  }, NOMS_INVENTES);
  // Réciproque de B12 : chaque page contenant encore des exemples porte
  // bien la bannière, et aucune bannière n'est posée sur une page qui
  // n'en a pas besoin.
  const pagesAvecBanniere = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.page').forEach(p => {
      if ((p.textContent || '').indexOf('Page de démonstration') !== -1) out.push(p.id);
    });
    return out;
  });
  check('B13 : toute page contenant des exemples porte la bannière',
    pagesDemo.every(id => pagesAvecBanniere.indexOf(id) !== -1),
    'exemples: ' + JSON.stringify(pagesDemo));
  // Et aucune bannière n'est posée sur une page qui, elle, affiche de
  // vraies données : ce serait aussi trompeur que l'inverse.
  const PAGES_REELLES = ['page-admin-dashboard', 'page-admin-candidatures', 'page-admin-missions',
                         'page-admin-clients', 'page-admin-devis', 'page-admin-acquisition',
                         'page-admin-facturation', 'page-admin-archivage'];
  check('B13b : aucune bannière sur une page alimentée par de vraies données',
    PAGES_REELLES.every(id => pagesAvecBanniere.indexOf(id) === -1),
    JSON.stringify(pagesAvecBanniere));
  check('B14 : le jeu de missions inventé et ses deux fonctions ont disparu du code',
    !/^const MISSIONS = \[/m.test(src)
    && src.indexOf('function showMission(') === -1
    && src.indexOf('function showMissionDetail(') === -1);
  check('B15 : et avec eux les boutons qui annonçaient un SMS au client',
    src.indexOf("alert('📱 SMS envoyé au client.')") === -1);
  check('B16 : la modale « Informations mission » écrite en dur a disparu',
    src.indexOf('id="modal-info-mission"') === -1
    && src.indexOf('function openInfoMission') === -1);

  // ── C. LA BASE CLIENTS EST RÉELLE ──
  await page.evaluate(() => showPage('admin-clients'));
  await page.waitForTimeout(600);
  const cli = await page.evaluate(() => ({
    corps: (document.getElementById('clients-table') || {}).textContent || '',
    sous: (document.getElementById('clients-count-sub') || {}).textContent || '',
    lignes: document.querySelectorAll('#clients-table tr').length,
  }));
  check('C1 : la base clients lit Supabase', /HC-QA-1/.test(cli.corps), cli.corps.slice(0, 150));
  check('C2 : un client sans compte n\'y figure pas',
    !/TEST-QA Anonyme/.test(cli.corps), cli.corps.slice(0, 200));
  check('C3 : deux demandes du même compte ne le dédoublent pas',
    cli.lignes === 1, String(cli.lignes));
  check('C4 : et ses demandes sont comptées', /HC-QA-1/.test(cli.corps) && /2/.test(cli.corps));
  check('C5 : le compteur « 47 inscrits » inventé a disparu',
    !/47 inscrits/.test(src) && /compte\(s\) client/.test(cli.sous), cli.sous);
  // Km total existe RÉELLEMENT sur les convoyeurs : la colonne y reste
  // légitime. Ce qui est vérifié, c'est que la table CLIENTS n'affiche
  // plus de colonnes qu'aucune donnée n'alimente.
  const entetesClients = await page.evaluate(() => {
    const t = document.getElementById('clients-table');
    const tab = t ? t.closest('table') : null;
    return tab ? Array.from(tab.querySelectorAll('thead th')).map(x => x.textContent.trim()) : [];
  });
  check('C6 : la table clients n\'affiche plus Km total, Palier ni VIN',
    ['Km total', 'Palier', 'VIN'].every(c => entetesClients.indexOf(c) === -1),
    JSON.stringify(entetesClients));
  check('C7 : elle n\'affiche que des colonnes réellement alimentées',
    entetesClients.length === 8 && entetesClients.indexOf('Demandes') !== -1,
    JSON.stringify(entetesClients));

  // ── D. PLUS AUCUNE PROMESSE D'E-MAIL OU DE SMS NON TENUE ──
  // LOT X01 — les blocs « retenue », « notification », « RIB » et « SMS »
  // (succès affichés sans rien faire) et l'historique de notation fictif
  // ont été retirés : ils n'existent plus, ni dans le code, ni à l'écran.
  check('D1 : les faux succès de la page Paramètres ont disparu (RIB, notification, SMS, retenue)',
    src.indexOf('RIB enregistré de manière sécurisée') === -1
    && src.indexOf('Notification envoyée à tous les convoyeurs') === -1
    && src.indexOf('Configuration SMS enregistrée') === -1
    && src.indexOf('function envoyerPenalite') === -1);
  check('D2 : l\'historique de notation fictif n\'existe plus',
    src.indexOf('function openNotationAdmin') === -1
    && (await page.evaluate(() => typeof window.openNotationAdmin === 'undefined' && typeof window.envoyerPenalite === 'undefined')));

  check('D3 : plus aucun e-mail n\'a réellement été tenté',
    (await page.evaluate(() => window.__emails.length)) === 0);
  check('D4 : la fonction qui listait des documents inventés a disparu',
    src.indexOf('function voirDocumentsConvoyeur') === -1
    && src.indexOf('RC Pro — valide jusqu\'au 12/2025') === -1);
  check('D5 : la fonction morte refuserFromModal a disparu',
    src.indexOf('function refuserFromModal') === -1);
  check('D6 : plus aucun blocage automatique annoncé sur une note',
    src.indexOf('automatiquement bloqué et a reçu un email') === -1
    && src.indexOf('déclenchera un blocage automatique') === -1);
  check('D7 : le signalement d\'incident n\'annonce plus SMS ni e-mail',
    src.indexOf('SMS client envoyé automatiquement') === -1);
  check('D8 : la page SMS ne prétend plus en envoyer aujourd\'hui',
    src.indexOf('Un SMS est envoyé automatiquement au client lorsque le convoyeur arrive') === -1);

  // ── E. LES PAGES FICTIVES N'EXISTENT PLUS (LOT X01) ──
  for (const [id, nom] of [['admin-challenge', 'Challenge mensuel'],
                           ['admin-pannes', 'Pannes'],
                           ['admin-notations', 'Notations'],
                           ['convoyeur-panne', 'Signaler une panne'],
                           ['convoyeur-notation', 'Ma notation'],
                           ['convoyeur-recompenses', 'Récompenses']]) {
    const etat = await page.evaluate(i => ({
      page: !!document.getElementById('page-' + i),
      menu: Object.keys(NAVS).some(r => NAVS[r].some(x => x.id === i)),
      titre: !!PAGE_TITLES[i]
    }), id);
    check('E/' + nom + ' : la page fictive, son entrée de menu et son titre ont disparu',
      etat.page === false && etat.menu === false && etat.titre === false, JSON.stringify(etat));
  }
  check('E/bandeaux : plus aucune bannière « Page de démonstration » dans le Dashboard',
    src.indexOf('Page de démonstration') === -1);

  check('Z1 : aucune erreur JavaScript (accueil)', errs.length === 0, errs.slice(0, 3).join(' | '));
  check('Z2 : aucune erreur JavaScript (tentative de contournement)',
    errsA.length === 0, errsA.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
