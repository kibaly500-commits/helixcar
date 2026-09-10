// ══════════════════════════════════════════════════════════════════
// LOT B1 — UNE IDENTITÉ AUTH, PLUSIEURS CASQUETTES
// ══════════════════════════════════════════════════════════════════
// CE QUI ÉTAIT CONSTATÉ : une personne à la fois cliente et partenaire
// n'atteignait jamais son second espace. finaliserSessionParUid()
// prenait le PREMIER rôle trouvé — admin, puis partenaire, puis client
// — et s'arrêtait là. Aucun sélecteur, aucun moyen de basculer.
//
// Le vrai code du Dashboard est exécuté contre un double Supabase :
// aucune connexion réseau, aucun compte réel, aucun e-mail.
const { lancerNavigateur, urlFichier, fichier } = require('./env.js');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 260) + ']' : '')); fail++; echecs.push(l); }
}

// Double : les rôles renvoyés par le serveur sont pilotés par
// window.__roles ; les tables ne répondent que ce que la RLS
// autoriserait réellement pour l'identité en cours.
const INIT = `
window.__journal = [];
window.__roles = ['client'];
window.__uid = '77777777-0000-0000-0000-000000000001';
window.__session = { access_token: 'jwt', user: { id: window.__uid, email: 'deux@helixcar.test' } };

function _table(nom) {
  const req = { filtres: {} };
  const api = {
    select() { return api; },
    eq(c, v) { req.filtres[c] = v; return api; },
    order() { return api; },
    limit() { return api; },
    maybeSingle() { return api.then(r => r); },
    then(res) {
      window.__journal.push({ op: 'select', nom, filtres: Object.assign({}, req.filtres) });
      let lignes = [];
      // Ce que la RLS laisserait passer : rien qui n'appartienne à
      // l'identité en cours, et rien dont le rôle n'existe pas.
      if (nom === 'admins' && window.__roles.indexOf('admin') !== -1) {
        lignes = [{ id: 'a1', auth_user_id: window.__uid, email: 'deux@helixcar.test', actif: true }];
      }
      if (nom === 'v_mes_demandes' && window.__roles.indexOf('client') !== -1) {
        lignes = [{ id: 'd1', numero_client: 'TEST-QA-B1', type_service: 'convoyage',
                    statut: 'nouveau', prenom: 'TEST-QA', nom: 'Deux', email: 'deux@helixcar.test',
                    created_at: '2026-09-01T10:00:00Z' }];
      }
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
    signInWithPassword: async function (id) {
      window.__journal.push({ op: 'signIn', email: id && id.email });
      return { data: { session: window.__session, user: window.__session.user }, error: null };
    },
    signOut: async function () { window.__journal.push({ op: 'signOut' }); return {}; }
  },
  from: _table,
  rpc: async function (nom, params) {
    window.__journal.push({ op: 'rpc', nom, params });
    if (nom === 'roles_utilisateur') {
      if (window.__rpcEnPanne) return { data: null, error: { message: 'Failed to fetch' } };
      return { data: window.__roles.map(r => ({ role: r })), error: null };
    }
    return { data: null, error: null };
  },
  storage: { from: function () { return {}; } }
}; } };
window.emailjs = { init: function () {}, send: function () { return Promise.resolve(); } };

// Le Dashboard lit aussi par appels REST bruts (sbFetch). On repond
// exactement ce que la RLS laisserait passer pour l'identite en cours.
const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  const i = url.indexOf('/rest/v1/');
  if (i === -1) return _fetchReel.apply(window, arguments);
  const chemin = url.slice(i + 9);
  window.__journal.push({ op: 'rest', chemin: chemin.split('?')[0] });
  let lignes = [];
  if (chemin.indexOf('convoyeurs') === 0 && window.__roles.indexOf('partenaire') !== -1) {
    lignes = [{ id: 'c1', auth_user_id: window.__uid, prenom: 'TEST-QA', nom: 'Deux',
                email: 'deux@helixcar.test', statut: 'actif', bloque: false,
                activites: ['convoyage'], created_at: '2026-09-01T10:00:00Z' }];
  }
  return Promise.resolve({
    ok: true, status: 200,
    json: function () { return Promise.resolve(lignes); },
    text: function () { return Promise.resolve(JSON.stringify(lignes)); },
    headers: { get: function () { return null; } }
  });
};
`;

async function ouvrirDashboard(navigateur, roles) {
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1100 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await page.evaluate((r) => { window.__roles = r; }, roles);
  await page.evaluate(async () => {
    // Lot A01 : le Dashboard ne connecte plus personne ; la session vient du site.
    var __r = await sbAuth.auth.signInWithPassword({ email: 'deux@helixcar.test', password: 'motdepasse-test-qa' });
    var __uid = (__r && __r.data && __r.data.user) ? __r.data.user.id : null;
    var __ok = await finaliserSessionClient('deux@helixcar.test', null, __uid);
    if (__ok !== false) await _hcPreparerRoles('client', 'deux@helixcar.test', __uid);
  });
  await page.waitForTimeout(250);
  page.jsErrors = erreurs;
  return page;
}

function etatEspace(page) {
  return page.evaluate(() => ({
    roles: (window._hcRolesAutorises || []).slice(),
    actif: window._hcRoleActif,
    selecteurVisible: (function () {
      const z = document.getElementById('sb-roles');
      return !!z && z.style.display !== 'none' && z.children.length > 0;
    })(),
    boutons: Array.prototype.slice
      .call(document.querySelectorAll('#sb-roles button'))
      .map(b => ({ role: b.getAttribute('data-hc-role'), texte: b.textContent,
                   courant: b.getAttribute('aria-current') === 'true' })),
    role: (typeof currentRole !== 'undefined') ? currentRole : null,
    titreNav: (document.querySelector('#sidebar-nav .nav-section-label') || {}).textContent || ''
  }));
}

(async () => {
  const navigateur = await lancerNavigateur();
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  const cc = fs.readFileSync(fichier('creer-compte-convoyeur.html'), 'utf8');

  // ══ A. UN SEUL RÔLE : AUCUN SÉLECTEUR ══
  {
    const page = await ouvrirDashboard(navigateur, ['client']);
    const e = await etatEspace(page);
    check('A1 : les rôles viennent du SERVEUR, pas d\'une devinette',
      JSON.stringify(e.roles) === JSON.stringify(['client']), JSON.stringify(e.roles));
    check('A2 : avec un seul rôle, aucun sélecteur n\'apparaît',
      e.selecteurVisible === false, JSON.stringify(e));
    check('A3 : et c\'est bien l\'espace client qui s\'ouvre',
      e.actif === 'client' && /Espace client/.test(e.titreNav), JSON.stringify(e));
    const j = await page.evaluate(() => window.__journal.filter(x => x.op === 'rpc').map(x => x.nom));
    check('A4 : la page a bien demandé ses rôles au serveur',
      j.indexOf('roles_utilisateur') !== -1, JSON.stringify(j));
    check('A5 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ B. DEUX RÔLES : UN SÉLECTEUR, ET UN SEUL CLIC POUR BASCULER ══
  {
    const page = await ouvrirDashboard(navigateur, ['client', 'partenaire']);
    let e = await etatEspace(page);
    check('B1 : avec deux rôles, le sélecteur apparaît',
      e.selecteurVisible === true && e.boutons.length === 2, JSON.stringify(e));
    check('B2 : il ne propose QUE les rôles confirmés par le serveur',
      e.boutons.map(b => b.role).sort().join(',') === 'client,partenaire',
      JSON.stringify(e.boutons));
    check('B3 : aucun espace administrateur n\'est proposé',
      e.boutons.every(b => b.role !== 'admin'), JSON.stringify(e.boutons));

    const avant = await page.evaluate(() => window.__journal.filter(x => x.op === 'signIn').length);
    await page.evaluate(() => {
      const b = document.querySelector('#sb-roles button[data-hc-role="partenaire"]');
      if (b) b.click();
    });
    await page.waitForTimeout(300);
    e = await etatEspace(page);
    const apres = await page.evaluate(() => window.__journal.filter(x => x.op === 'signIn').length);
    check('B4 : un clic bascule vers l\'espace partenaire',
      e.actif === 'partenaire', JSON.stringify(e));
    check('B5 : sans AUCUNE nouvelle connexion',
      apres === avant, 'avant=' + avant + ' apres=' + apres);
    check('B6 : et sans jamais fermer la session',
      (await page.evaluate(() => window.__journal.filter(x => x.op === 'signOut').length)) === 0);
    check('B7 : le bouton actif est signalé aux lecteurs d\'écran',
      e.boutons.filter(b => b.courant).length === 1
      && (e.boutons.find(b => b.courant) || {}).role === 'partenaire',
      JSON.stringify(e.boutons));
    await page.close();
  }

  // ══ C. UN ESPACE NON ATTRIBUÉ RESTE INACCESSIBLE ══
  {
    const page = await ouvrirDashboard(navigateur, ['client']);
    const tentative = await page.evaluate(async () => {
      const avant = window._hcRoleActif;
      const r = await _hcOuvrirEspace('admin', 'deux@helixcar.test', window.__uid);
      return { retour: r, avant, apres: window._hcRoleActif };
    });
    check('C1 : ouvrir un espace non attribué est refusé net',
      tentative.retour === false, JSON.stringify(tentative));
    check('C2 : et le rôle actif ne change pas',
      tentative.apres === tentative.avant, JSON.stringify(tentative));

    const tentative2 = await page.evaluate(async () => {
      const r = await _hcOuvrirEspace('partenaire', 'deux@helixcar.test', window.__uid);
      return { retour: r, actif: window._hcRoleActif };
    });
    check('C3 : même chose pour un espace partenaire non attribué',
      tentative2.retour === false && tentative2.actif === 'client', JSON.stringify(tentative2));
    await page.close();
  }

  // ══ D. TROIS RÔLES, DONT ADMINISTRATEUR ══
  {
    const page = await ouvrirDashboard(navigateur, ['admin', 'client']);
    // L'ordre d'ouverture par defaut s'applique a l'arrivee par lien ou
    // par session restauree (finaliserSessionParUid), pas a une
    // connexion faite exprès par l'onglet client.
    await page.evaluate(async () => {
      await finaliserSessionParUid('deux@helixcar.test', window.__uid);
    });
    await page.waitForTimeout(250);
    const e = await etatEspace(page);
    check('D1 : l\'ordre d\'ouverture par défaut reste admin d\'abord',
      e.actif === 'admin' && /Administration/.test(e.titreNav), JSON.stringify(e));
    check('D2 : les deux espaces sont proposés',
      e.boutons.map(b => b.role).sort().join(',') === 'admin,client', JSON.stringify(e.boutons));

    await page.evaluate(() => {
      const b = document.querySelector('#sb-roles button[data-hc-role="client"]');
      if (b) b.click();
    });
    await page.waitForTimeout(300);
    const apres = await etatEspace(page);
    check('D3 : l\'administrateur peut basculer sur son espace client',
      apres.actif === 'client' && /Espace client/.test(apres.titreNav), JSON.stringify(apres));
    await page.close();
  }

  // ══ E. EN CAS DE PANNE, ON NE DEVINE PAS DES RÔLES ══
  {
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 1100 } });
    page.on('dialog', d => d.accept());
    await page.addInitScript(INIT);
    await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
    await page.evaluate(() => { window.__rpcEnPanne = true; window.__roles = ['client']; });
    await page.evaluate(async () => {
      // Lot A01 : le Dashboard ne connecte plus personne ; la session vient du site.
      var __r = await sbAuth.auth.signInWithPassword({ email: 'deux@helixcar.test', password: 'motdepasse-test-qa' });
      var __uid = (__r && __r.data && __r.data.user) ? __r.data.user.id : null;
      var __ok = await finaliserSessionClient('deux@helixcar.test', null, __uid);
      if (__ok !== false) await _hcPreparerRoles('client', 'deux@helixcar.test', __uid);
    });
    await page.waitForTimeout(300);
    const e = await etatEspace(page);
    check('E1 : si le serveur ne répond pas, aucun rôle n\'est inventé',
      e.roles.length === 0, JSON.stringify(e.roles));
    check('E2 : et aucun sélecteur n\'est affiché',
      e.selecteurVisible === false, JSON.stringify(e));
    check('E3 : l\'enchaînement historique prend le relais',
      e.role === 'client', JSON.stringify(e));
    await page.close();
  }

  // ══ F. LE CODE LUI-MÊME ══
  check('F1 : les rôles sont lus par la fonction serveur, jamais déduits',
    /rpc\('roles_utilisateur'\)/.test(dash));
  check('F2 : le sélecteur n\'apparaît qu\'à partir de deux rôles',
    /if \(roles\.length < 2\) \{ zone\.style\.display = 'none'/.test(dash));
  check('F3 : _hcOuvrirEspace refuse tout rôle non confirmé',
    /if \(window\._hcRolesAutorises\.indexOf\(role\) === -1\)/.test(dash));
  check('F4 : aucune RLS n\'est élargie par le changement d\'espace',
    !/service_role/.test(dash.slice(dash.indexOf('function _hcOuvrirEspace'),
                                    dash.indexOf('function _hcOuvrirEspace') + 900)));

  // La création de compte partenaire ne crée JAMAIS un second mot de passe.
  check('F5 : la page partenaire tente D\'ABORD de se connecter',
    /signInWithPassword\(\{ email: email, password: pw \}\)/.test(cc)
    && cc.indexOf('signInWithPassword') < cc.indexOf('auth.signUp'));
  check('F6 : si le compte existe, elle ajoute le rôle au lieu d\'en créer un autre',
    /rpc\('ajouter_role_partenaire'/.test(cc));
  check('F7 : le PATCH anonyme sur auth_user_id a disparu',
    !/convoyeurs\?id=eq\.[\s\S]{0,400}auth_user_id/.test(cc));
  check('F8 : et plus aucune adresse d\'aperçu codée en dur',
    !/helixcar-i89b/.test(cc));

  await navigateur.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
