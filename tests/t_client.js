// ESPACE CLIENT — NOUVELLE DEMANDE DEPUIS LE DASHBOARD
// Exécute le vrai code des deux pages contre un double Supabase injecté
// AVANT les scripts (le CDN supabase-js est injoignable ici).
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier , jourCivil, dansNJours } = require('./env.js');
const path = require('path');
const L = require('./lib.js');   // mêmes aides de remplissage que les autres suites

// Date CIVILE, jamais UTC : toISOString() reculerait d'un jour en
// France (voir jourCivil dans tests/env.js).
const futur = dansNJours;
async function setVal(page, id, v) {
  await page.evaluate(([i, val]) => {
    const e = document.getElementById(i);
    e.value = val; e.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, v]);
  await page.waitForTimeout(30);
}
async function ouvrirRubrique(page, cle) {
  await page.evaluate(c => proBasculerRubrique(c), cle);
  await page.waitForTimeout(40);
}

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}


// Double Supabase commun aux deux pages : session réelle simulée,
// journal de toutes les écritures, et instrumentation d'EmailJS.
const INIT = `
window.__journal = [];
window.__emails = [];
window.__session = {
  access_token: 'jwt-client',
  user: { id: '55555555-5555-5555-5555-555555555555', email: 'clientA@helixcar.test' }
};
window.__demandes = [{
  id: 'dem-1', numero_client: 'TEST-QA-A1', type_service: 'convoyage', statut: 'nouveau',
  prenom: 'TEST-QA', nom: 'ClientA', email: 'clientA@helixcar.test',
  telephone: '+33600000010', type_client: 'pro', societe: 'TEST-QA Flotte SAS',
  siret: '900 068 685 00012', created_at: '2026-09-01T10:00:00Z'
}];
window.__reseauCoupe = false;

function _table(nom) {
  const req = { tri: null, limite: null, filtres: {} };
  const api = {
    select() { return api; },
    eq(c, v) { req.filtres[c] = v; return api; },
    order() { return api; },
    limit(n) { req.limite = n; return api; },
    then(resoudre) {
      if (window.__reseauCoupe) {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(resoudre);
      }
      let lignes = nom === 'v_mes_demandes' ? window.__demandes.slice() : [];
      if (req.limite) lignes = lignes.slice(0, req.limite);
      return Promise.resolve({ data: lignes, error: null }).then(resoudre);
    },
    update(valeurs) {
      const majApi = {
        eq(c, v) { req.filtres[c] = v; return majApi; },
        then(resoudre) {
          window.__journal.push({ op: 'update', nom, valeurs, filtres: Object.assign({}, req.filtres) });
          return Promise.resolve({ error: null }).then(resoudre);
        }
      };
      return majApi;
    },
    insert(v) { window.__journal.push({ op: 'insert', nom, v }); return Promise.resolve({ error: null }); }
  };
  return api;
}

window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function (ident) {
      window.__journal.push({ op: 'signIn', email: ident && ident.email });
      if (window.__refusConnexion) return { data: null, error: { message: 'Invalid login credentials' } };
      return { data: { session: window.__session, user: window.__session.user }, error: null };
    },
    signUp: async function (ident) {
      window.__journal.push({ op: 'signUp', email: ident && ident.email });
      return { data: { user: { id: '77777777-7777-7777-7777-777777777777' } }, error: null };
    },
    signOut: async function () { window.__journal.push({ op: 'signOut' }); return {}; }
  },
  from: _table,
  rpc: async function (nom, params) {
    // La session AU MOMENT de l'appel : c'est elle qui rattache la
    // demande côté serveur (auth.uid()), et rien d'autre.
    window.__journal.push({ op: 'rpc', nom, params,
      session: (window.__session && window.__session.user && window.__session.user.id) || null });
    if (window.__reseauCoupe) return { data: null, error: { message: 'Failed to fetch' } };
    if (nom === 'informations_demande') return { data: window.__infos || [], error: null };
    if (nom === 'repondre_informations_demande') return { data: 1, error: null };
    if (nom === 'creer_demande_avec_vehicules') {
      if (window.__reseauCoupe) return { data: null, error: { message: 'Failed to fetch' } };
      return { data: { id: (params && params.p_demande && params.p_demande.id) || 'x', vehicules: 0 }, error: null };
    }
    return { data: null, error: null };
  },
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: null }; } }; } }
}; } };

window.emailjs = {
  init: function () {},
  send: function () { window.__emails.push(Array.from(arguments)); return Promise.resolve(); },
  sendForm: function () { window.__emails.push(['form']); return Promise.resolve(); }
};

// Journalise les écritures REST du formulaire public (fetch direct).
const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  const i = url.indexOf('/rest/v1/');
  if (i === -1) return _fetchReel.apply(window, arguments);
  options = options || {};
  let corps = null;
  try { corps = options.body ? JSON.parse(options.body) : null; } catch (e) {}
  window.__journal.push({
    op: 'rest', table: url.slice(i + 9).split('?')[0],
    methode: (options.method || 'GET').toUpperCase(),
    prefer: (options.headers || {})['Prefer'] || '',
    corps: corps
  });
  if (window.__reseauCoupe) return Promise.reject(new Error('Failed to fetch'));
  return Promise.resolve({
    ok: true, status: 201,
    text: function () { return Promise.resolve(''); }
  });
};
`;

(async () => {
  const navigateur = await lancerNavigateur();
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1100 } });
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);

  // ── A. ESPACE CLIENT : session réelle et action visible ──
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  const connexion = await page.evaluate(async () => {
    loginRole = 'client';
    document.getElementById('login-email').value = 'clientA@helixcar.test';
    document.getElementById('login-pw').value = 'motdepasse';
    await doLogin();
    return {
      role: currentRole,
      client: !!window._currentClient,
      demandes: (window._currentClient || {}).demandes ? window._currentClient.demandes.length : 0,
      journal: window.__journal.map(j => j.op)
    };
  });
  check('A1 : le client ouvre une VRAIE session Supabase', connexion.journal.includes('signIn'), JSON.stringify(connexion.journal));
  check('A2 : le rôle client est établi', connexion.role === 'client' && connexion.client === true, JSON.stringify(connexion));
  check('A3 : ses demandes sont chargées depuis la base', connexion.demandes === 1, String(connexion.demandes));

  const nav = await page.evaluate(() => Array.from(document.querySelectorAll('#sidebar-nav .nav-item')).map(b => b.textContent));
  check('A4 : l\'onglet « Informations à compléter » existe',
    nav.some(t => /Informations à compléter/.test(t)), JSON.stringify(nav));

  await page.evaluate(async () => { showPage('client-dashboard'); });
  await page.waitForTimeout(150);
  const accueil = await page.evaluate(() => ({
    bouton: !!Array.from(document.querySelectorAll('#page-client-dashboard button'))
      .find(b => /Faire une nouvelle demande/.test(b.textContent)),
    liste: (document.getElementById('client-demandes-liste') || {}).textContent || ''
  }));
  check('A5 : l\'action « Faire une nouvelle demande » est visible', accueil.bouton);
  check('A6 : la demande réelle apparaît dans l\'espace client',
    /TEST-QA-A1/.test(accueil.liste) && /Convoyage automobile/.test(accueil.liste), accueil.liste.slice(0, 120));

  // ══ RÈGLE INVERSÉE SUR DEMANDE EXPLICITE (lot C1) ══
  // Cette vérification exigeait que le bouton QUITTE le Dashboard pour
  // la vitrine. Le propriétaire demande l'inverse : la demande doit se
  // faire DANS l'espace client, navigation visible. Le contrôle n'est
  // pas supprimé — il devient plus exigeant, puisqu'il faut désormais
  // à la fois rester dans l'espace ET charger le vrai formulaire.
  const urlAvant = page.url();
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('#page-client-dashboard button'))
      .find(b => /Faire une nouvelle demande/.test(b.textContent)).click();
  });
  await page.waitForTimeout(500);
  const apresClic = await page.evaluate(() => ({
    url: window.location.href,
    pageActive: (document.querySelector('.page.active') || {}).id,
    navVisible: document.querySelectorAll('#sidebar-nav .nav-item').length > 0,
    src: (document.getElementById('client-demande-cadre') || {}).getAttribute('src')
  }));
  check('A7 : on reste dans l\'espace client, navigation visible',
    apresClic.url === urlAvant && apresClic.navVisible === true
    && apresClic.pageActive === 'page-client-nouvelle-demande', JSON.stringify(apresClic));
  check('A7 bis : et c\'est bien le VRAI formulaire qui est chargé, pas une copie',
    /index\.html\?nouvelle-demande=1&integre=1/.test(apresClic.src || ''),
    String(apresClic.src));

  // ── B. MODE CONNECTÉ DANS LE FORMULAIRE PUBLIC ──
  await page.goto(urlFichier('index.html') + '?nouvelle-demande=1', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const modeConnecte = await page.evaluate(() => ({
    modaleOuverte: document.getElementById('modal-client').classList.contains('open'),
    etape: _formStepState.client,
    etapeVisible: (document.querySelector('#modal-client-form .form-step.active') || {}).dataset
      ? document.querySelector('#modal-client-form .form-step.active').dataset.step : null,
    prenom: (document.getElementById('client-prenom') || {}).value,
    nom: (document.getElementById('client-nom') || {}).value,
    email: (document.getElementById('client-email') || {}).value,
    tel: (document.getElementById('client-tel') || {}).value,
    typeClient: (document.getElementById('client-type') || {}).value,
    societe: (document.getElementById('client-societe') || {}).value,
    emailVerrouille: (document.getElementById('client-email') || {}).readOnly,
    mdpRequis: (document.getElementById('client-password') || {}).required,
    // LOT E1 — la visibilite ne passe plus par un style en ligne mais
    // par le composant partage. On verifie donc la GARANTIE (le bandeau
    // est reellement visible et porte un texte), pas le mecanisme.
    bandeau: (function () {
      var b = document.getElementById('hc-bandeau-connecte');
      if (!b) return null;
      var st = getComputedStyle(b);
      return {
        visible: b.classList.contains('visible') && st.display !== 'none',
        texte: (b.textContent || '').trim(),
        fond: st.backgroundColor,
        bordureGauche: st.borderLeftWidth
      };
    })()
  }));
  check('B1 : le parcours s\'ouvre directement', modeConnecte.modaleOuverte);
  check('B2 : il démarre sur « Comment pouvons-nous vous accompagner ? »',
    String(modeConnecte.etapeVisible) === '2', JSON.stringify(modeConnecte));
  check('B3 : le profil est prérempli depuis la vraie session',
    modeConnecte.prenom === 'TEST-QA' && modeConnecte.nom === 'ClientA'
    && modeConnecte.tel === '+33600000010', JSON.stringify(modeConnecte));
  check('B4 : l\'e-mail déjà vérifié n\'est pas redemandé',
    modeConnecte.email === 'clientA@helixcar.test' && modeConnecte.emailVerrouille === true);
  check('B5 : la création de compte n\'est pas redemandée', modeConnecte.mdpRequis === false);
  check('B6 : le client sait qu\'il est reconnu',
    !!modeConnecte.bandeau && modeConnecte.bandeau.visible === true
    && /Vous êtes connecté/.test(modeConnecte.bandeau.texte),
    JSON.stringify(modeConnecte.bandeau));
  // LOT E1 — et ce n'est plus un grand encadre vert : fond transparent,
  // seul un filet vertical le signale.
  check('B6 bis : le bandeau n\'est plus un grand encadré vert',
    !!modeConnecte.bandeau
    && /rgba\(0, 0, 0, 0\)|transparent/.test(modeConnecte.bandeau.fond)
    && parseFloat(modeConnecte.bandeau.bordureGauche) >= 2,
    JSON.stringify(modeConnecte.bandeau));
  check('B6b : le statut professionnel du profil est repris',
    modeConnecte.typeClient === 'pro' && modeConnecte.societe === 'TEST-QA Flotte SAS',
    JSON.stringify(modeConnecte));

  const services = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[name="type-service"]')).map(i => i.value));
  check('B7 : les quatre services sont proposés',
    ['convoyage', 'stockage', 'nettoyage', 'professionnel'].every(s => services.includes(s)),
    JSON.stringify(services));

  // ── C. PAYLOAD IDENTIQUE ET RATTACHÉ AU COMPTE ──
  // On remplit le parcours avec les MÊMES aides que les autres suites :
  // s'il divergeait du formulaire public, ces aides échoueraient.
  await page.evaluate(() => { window.__journal = []; });
  await L.chooseService(page, 'nettoyage');
  await L.fillNettoyageStep2(page, 3, { citadine: 3 }, 'preparation_complete');
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(200);
  await L.fillNettoyageStep4(page, { contactType: 'moi' });
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  await page.evaluate(async () => { try { await submitClientForm(); } catch (e) {} });
  await page.waitForTimeout(300);
  // L'écriture passe désormais par creer_demande_avec_vehicules :
  // une seule transaction serveur au lieu de deux requêtes REST.
  const payload = await page.evaluate(() => window.__journal.filter(j => j.op === 'rpc'));
  const appel = payload.filter(j => j.nom === 'creer_demande_avec_vehicules')[0];
  const demande = appel && appel.params && appel.params.p_demande;
  check('C1 : la demande part par l\'écriture atomique unique', !!demande,
    JSON.stringify(payload.map(j => j.nom)).slice(0, 200));
  if (demande) {
    check('C2 : elle porte un identifiant généré côté navigateur',
      !!demande.id, String(demande.id));
    // LE NAVIGATEUR NE DÉSIGNE PAS LE PROPRIÉTAIRE.
    //
    // La migration 92 ignore volontairement tout auth_user_id reçu et
    // n'utilise que auth.uid() : sans cela, n'importe qui pourrait
    // s'attribuer la demande d'un tiers. Vérifier que le navigateur
    // envoie le bon identifiant revenait donc à vérifier une valeur que
    // le serveur jette — et à croire un rattachement qui n'a pas
    // forcément eu lieu.
    //
    // Ce qui rattache, c'est la SESSION au moment de l'appel. C'est
    // cela qu'on vérifie.
    check('C3 : le navigateur ne prétend PAS désigner le propriétaire',
      demande.auth_user_id === undefined, String(demande.auth_user_id));
    check('C3b : et l\'appel part bien avec une session ouverte — c\'est elle qui rattache',
      appel.session === '55555555-5555-5555-5555-555555555555', String(appel.session));
    check('C4 : elle reçoit une référence HelixCar',
      !!demande.numero_client, String(demande.numero_client));
    check('C5 : elle porte le service choisi',
      demande.type_service === 'nettoyage', String(demande.type_service));
    check('C5b : les véhicules voyagent avec la demande, pas séparément',
      Array.isArray(appel.params.p_vehicules)
      && payload.filter(j => j.nom === 'creer_demande_avec_vehicules').length === 1,
      JSON.stringify(appel.params.p_vehicules).slice(0, 120));
  }

  // ── C bis. RÉCAPITULATIF, CONTACT « AUTRE », RETOUR ARRIÈRE ──
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(urlFichier('index.html') + '?nouvelle-demande=1', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__journal = []; });
  await L.chooseService(page, 'nettoyage');
  await L.fillNettoyageStep2(page, 2, { citadine: 2 }, 'preparation_complete');
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(200);
  await L.fillNettoyageStep4(page, { contactType: 'autre', contactNom: 'TEST-QA Karim', contactTel: '+33600000077' });
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(300);
  const recap = await page.evaluate(() => ({
    etape: _formStepState.client,
    texte: (document.getElementById('recap-demande') || {}).textContent || ''
  }));
  check('C6 : le récapitulatif est bien celui du formulaire public',
    recap.etape === 5 && /Karim/.test(recap.texte), JSON.stringify(recap).slice(0, 160));

  // Retour arrière : on revient sur l'organisation sans perdre la saisie.
  // Au récapitulatif la barre de navigation est masquée : on appelle la
  // même fonction que le bouton Retour, sans la contourner.
  await page.evaluate(() => clientStepPrev());
  await page.waitForTimeout(250);
  const retour = await page.evaluate(() => ({
    etape: _formStepState.client,
    nom: (document.getElementById('nett-contact-sp-nom') || {}).value
  }));
  check('C7 : le retour arrière conserve les saisies',
    retour.etape === 4 && retour.nom === 'TEST-QA Karim', JSON.stringify(retour));

  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  await page.evaluate(async () => { try { await submitClientForm(); } catch (e) {} });
  await page.waitForTimeout(300);
  const envoiAutre = await page.evaluate(() =>
    ((window.__journal.filter(j => j.op === 'rpc' && j.nom === 'creer_demande_avec_vehicules')[0] || {}).params || {}).p_demande || null);
  check('C8 : « Contact sur place : une autre personne » arrive dans le payload',
    !!envoiAutre && JSON.stringify(envoiAutre).indexOf('TEST-QA Karim') !== -1,
    JSON.stringify(envoiAutre && envoiAutre.nettoyage_details).slice(0, 160));

  // ── C ter. TROUVER UN PROFESSIONNEL, DE BOUT EN BOUT ──
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(urlFichier('index.html') + '?nouvelle-demande=1', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__journal = []; });
  await L.chooseService(page, 'professionnel');
  await ouvrirRubrique(page, 'besoin');
  await page.click('input[name="pro-categorie"][value="renfort"]');
  await page.waitForTimeout(80);
  await page.click('input[name="pro-mission"][value="conseil"]');
  await page.waitForTimeout(60);
  await ouvrirRubrique(page, 'lieu');
  await page.fill('#pro-adresse-rue', '18 rue de Paris');
  await page.fill('#pro-adresse-cp', '93160');
  await page.fill('#pro-adresse-ville', 'Noisy-le-Grand');
  await L.fillContactSurPlace(page, 'pro', 'moi');
  await ouvrirRubrique(page, 'periode');
  await setVal(page, 'pro-date-debut', futur(14));
  await setVal(page, 'pro-date-fin', futur(15));
  await setVal(page, 'pro-horaire-cdeb', '09:00');
  await setVal(page, 'pro-horaire-cfin', '17:00');
  await ouvrirRubrique(page, 'mission');
  await page.fill('#pro-description', 'TEST-QA renfort ponctuel sur atelier');
  await page.evaluate(() => _proMajBoutonContinuer());
  await page.waitForTimeout(80);
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(300);
  await page.evaluate(async () => { try { await submitClientForm(); } catch (e) {} });
  await page.waitForTimeout(300);
  const envoiPro = await page.evaluate(() =>
    ((window.__journal.filter(j => j.op === 'rpc' && j.nom === 'creer_demande_avec_vehicules')[0] || {}).params || {}).p_demande || null);
  check('C9 : « Trouver un professionnel » est réellement enregistrable',
    !!envoiPro && envoiPro.type_service === 'professionnel' && !!envoiPro.professionnel_details,
    JSON.stringify(envoiPro && envoiPro.type_service));
  check('C10 : cette demande non plus ne désigne son propriétaire',
    !!envoiPro && envoiPro.auth_user_id === undefined,
    String(envoiPro && envoiPro.auth_user_id));

  // ── D. DOUBLE CLIC, F5, COUPURE RÉSEAU ──
  // On repart d'un état propre : la restauration de brouillon a sa
  // propre suite (t_brouillon) et n'a pas à interférer ici.
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(urlFichier('index.html') + '?nouvelle-demande=1', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const apresF5 = await page.evaluate(() => ({
    etape: (document.querySelector('#modal-client-form .form-step.active') || {}).dataset.step,
    prenom: (document.getElementById('client-prenom') || {}).value
  }));
  check('D1 : après F5, le mode connecté est rétabli depuis la session',
    String(apresF5.etape) === '2' && apresF5.prenom === 'TEST-QA', JSON.stringify(apresF5));

  await page.evaluate(() => { window.__journal = []; window.__reseauCoupe = true; });
  await L.chooseService(page, 'nettoyage');
  await L.fillNettoyageStep2(page, 2, { citadine: 2 }, 'preparation_complete');
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(200);
  await L.fillNettoyageStep4(page, { contactType: 'moi' });
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  // Double clic réel : deux soumissions lancées coup sur coup.
  await page.evaluate(async () => {
    try { submitClientForm(); submitClientForm(); } catch (e) {}
  });
  await page.waitForTimeout(400);
  const coupure = await page.evaluate(() => {
    window.__reseauCoupe = false;
    return {
      succes: (document.getElementById('client-success-msg') || {}).innerHTML || '',
      tentatives: window.__journal.filter(j => j.op === 'rpc' && j.nom === 'creer_demande_avec_vehicules').length
    };
  });
  check('D2 : une coupure réseau n\'annonce JAMAIS un succès',
    !/bien été enregistrée/.test(coupure.succes), coupure.succes.slice(0, 80));
  check('D3 : un double clic ne crée PAS deux demandes',
    coupure.tentatives <= 1, 'POST=' + coupure.tentatives);

  check('D4 : aucune erreur JS sur le parcours client', erreursJs.length === 0, erreursJs.join(' | '));

  // ── E. GARDE-FOUS ──
  const emails = await page.evaluate(() => window.__emails.length);
  check('E1 : aucun e-mail supplémentaire déclenché par ce parcours', emails === 0, String(emails));

  const fs = require('fs');
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  check('E2 : le dashboard ne contient AUCUNE copie du formulaire',
    !/name="type-service"/.test(dash) && /name="type-service"/.test(idx));
  // La règle vérifiée est bien « l'espace CLIENT ne crée aucune
  // mission ». La version précédente examinait TOUT ce qui suit la
  // bannière « ESPACE CLIENT », y compris le code d'administration écrit
  // plus bas : la création d'une mission de nettoyage par
  // l'administrateur la faisait échouer alors que l'espace client n'y
  // est pour rien. On borne donc la lecture au bloc lui-même.
  const debutClient = dash.indexOf('ESPACE CLIENT —');
  const finClient = dash.indexOf('RÉINITIALISATION DU MOT DE PASSE', debutClient);
  const blocClient = dash.slice(debutClient, finClient > debutClient ? finClient : dash.length);
  check('E3 : aucune mission créée par le parcours CLIENT',
    !/from\('missions'\)\s*\.insert|rest\/v1\/missions[^']*POST/.test(blocClient));
  check('E4 : le mot de passe client n\'est plus collecté en pure perte',
    /auth\.signUp/.test(idx));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  await navigateur.close();
  process.exit(fail ? 1 : 0);
})();
