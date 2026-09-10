// ══════════════════════════════════════════════════════════════════
// LOT A01 — UN SEUL PARCOURS DE CONNEXION, ET UNE RÉCUPÉRATION QUI
// NE FUIT PAS
// ══════════════════════════════════════════════════════════════════
// CE QUI ÉTAIT CONSTATÉ (revue experte, A01-012 / 018 / 023..030 / 034,
// A01-001..011) :
//   * dashboard.html portait son propre écran « Connexion à votre
//     espace » avec trois onglets Admin / Convoyeur / Client : le rôle
//     était choisi par la personne AVANT la connexion, alors que le
//     serveur sait répondre (roles_utilisateur) ;
//   * la fenêtre « Nouveau mot de passe » s'ouvrait DERRIÈRE cet écran
//     (z-index 500 contre 999) : ouverte, mais inatteignable ;
//   * un drapeau de récupération abandonné rouvrait ce formulaire à la
//     connexion normale suivante, dans le même onglet ;
//   * la déconnexion ne remettait rien à zéro (rôles, sélecteur, barre
//     mobile, drapeau) et n'attendait pas la fermeture de session ;
//   * sur le site, le message « Si un compte correspond… » survivait à
//     la fermeture et à la réouverture de la fenêtre « Connexion » ;
//   * une société et un SIRET saisis en « Professionnel » partaient
//     avec la demande après retour sur « Particulier » ;
//   * « Votre compte HelixCar est maintenant créé » s'affichait aussi
//     quand rien n'avait été créé (compte existant, compte déjà connecté).
//
// Le vrai code des pages est exécuté contre un double Supabase : aucune
// connexion réseau, aucun compte réel, aucun e-mail. Les défauts sont
// d'abord REPRODUITS sur les pages d'origin/main, puis vérifiés
// corrigés sur la branche.
const { lancerNavigateur, urlFichier, fichier, RACINE } = require('./env.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 300) + ']' : '')); fail++; echecs.push(l); }
}

// Double : rôles pilotés par window.__roles ; l'écouteur d'authentification
// est capturé pour rejouer les événements de Supabase ; le retour au site
// public est observé au lieu d'être navigué (aucune navigation réelle en
// file://).
const INIT = `
window.__journal = [];
window.__roles = ['client'];
window.__uid = '77777777-0000-0000-0000-00000000a001';
window.__session = { access_token: 'jwt', user: { id: window.__uid, email: 'a01@helixcar.test' } };
window.__retours = [];
window._hcRetourVitrine = function (motif) { window.__retours.push(motif || ''); };
window.__ecouteurs = [];
window.__emettre = function (evenement, session) { window.__ecouteurs.forEach(cb => cb(evenement, session)); };

function _table(nom) {
  const api = {
    select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; },
    maybeSingle() { return api.then(r => r); },
    then(res) {
      let lignes = [];
      if (nom === 'admins' && window.__roles.indexOf('admin') !== -1) {
        lignes = [{ id: 'a1', auth_user_id: window.__uid, email: 'a01@helixcar.test', actif: true }];
      }
      if (nom === 'v_mes_demandes' && window.__roles.indexOf('client') !== -1) {
        lignes = [{ id: 'd1', numero_client: 'TEST-QA-CLAUDE-HELIXCAR-A01', type_service: 'convoyage',
                    statut: 'nouveau', prenom: 'TEST-QA', nom: 'A01', email: 'a01@helixcar.test',
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
    onAuthStateChange: function (cb) { window.__ecouteurs.push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function (id) {
      window.__journal.push({ op: 'signIn', email: id && id.email });
      return { data: { session: window.__session, user: window.__session.user }, error: null };
    },
    signOut: async function () {
      // Lente à dessein : on vérifie que la déconnexion est ATTENDUE.
      await new Promise(r => setTimeout(r, 60));
      window.__journal.push({ op: 'signOut', t: Date.now() });
      return {};
    },
    updateUser: async function () { return { data: { user: window.__session.user }, error: null }; },
    resetPasswordForEmail: async function () { return { data: {}, error: null }; }
  },
  from: _table,
  rpc: async function (nom, params) {
    window.__journal.push({ op: 'rpc', nom, params });
    if (nom === 'roles_utilisateur') return { data: window.__roles.map(r => ({ role: r })), error: null };
    return { data: null, error: null };
  },
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: null }; } }; } }
}; } };
window.emailjs = { init: function () {}, send: function () { return Promise.resolve(); } };

const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  const i = url.indexOf('/rest/v1/');
  if (i === -1) return _fetchReel.apply(window, arguments);
  const chemin = url.slice(i + 9);
  let lignes = [];
  if (chemin.indexOf('convoyeurs') === 0 && window.__roles.indexOf('partenaire') !== -1) {
    lignes = [{ id: 'c1', auth_user_id: window.__uid, prenom: 'TEST-QA', nom: 'A01',
                email: 'a01@helixcar.test', statut: 'actif', bloque: false,
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

function fichierOrigine(nom) {
  try {
    const contenu = execSync('git show origin/main:' + nom, { cwd: RACINE, maxBuffer: 64 * 1024 * 1024 }).toString();
    const chemin = path.join(os.tmpdir(), 'helixcar-a01-origin-main-' + process.pid + '-' + nom);
    fs.writeFileSync(chemin, contenu);
    return chemin;
  } catch (e) { return null; }
}

async function ouvrir(navigateur, url, roles) {
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1000 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: 'load' });
  if (roles) await page.evaluate((r) => { window.__roles = r; }, roles);
  page.jsErrors = erreurs;
  return page;
}

// Le point central de la fenêtre « Nouveau mot de passe » est-il bien
// atteignable (rien ne la recouvre) ?
const ATTEIGNABLE = `(() => {
  const m = document.querySelector('#modal-reinit-mdp .modal');
  if (!m) return { ouverte: false, atteignable: false };
  const r = m.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    ouverte: document.getElementById('modal-reinit-mdp').classList.contains('open'),
    atteignable: !!(el && m.contains(el)),
    recouvertPar: el ? (el.id || el.className || el.tagName) : null
  };
})()`;

(async () => {
  const navigateur = await lancerNavigateur();
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const cc = fs.readFileSync(fichier('creer-compte-convoyeur.html'), 'utf8');

  // ══ A. REPRODUCTION SUR ORIGIN/MAIN ══
  const ancienDash = fichierOrigine('dashboard.html');
  const ancienIdx = fichierOrigine('index.html');
  if (ancienDash) {
    const page = await ouvrir(navigateur, 'file://' + ancienDash, ['client']);
    const avant = await page.evaluate(() => ({
      onglets: document.querySelectorAll('.login-tab').length,
      champEmail: !!document.getElementById('login-email'),
      titre: (document.querySelector('#login-screen h2') || {}).textContent || ''
    }));
    check('A1 : REPRODUCTION (origin/main) — un écran de connexion à trois onglets vit dans le Dashboard',
      avant.onglets === 3 && avant.champEmail && /Connexion à votre espace/.test(avant.titre), JSON.stringify(avant));

    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY', window.__session));
    await page.waitForTimeout(150);
    const recouverte = await page.evaluate(ATTEIGNABLE);
    check('A2 : REPRODUCTION (origin/main) — la fenêtre « Nouveau mot de passe » s\'ouvre DERRIÈRE l\'écran de connexion',
      recouverte.ouverte === true && recouverte.atteignable === false, JSON.stringify(recouverte));

    // Drapeau abandonné puis connexion normale : le formulaire revient.
    const rechute = await page.evaluate(async () => {
      closeModal('reinit-mdp');
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 250));
      return {
        drapeau: sessionStorage.getItem('helixcar_reinit_en_cours'),
        rouverte: document.getElementById('modal-reinit-mdp').classList.contains('open')
      };
    });
    check('A3 : REPRODUCTION (origin/main) — fermer la fenêtre laisse le drapeau, et une connexion normale la ROUVRE',
      rechute.drapeau === '1' && rechute.rouverte === true, JSON.stringify(rechute));

    // Déconnexion : l'état des rôles survit.
    const apresLogout = await page.evaluate(async () => {
      closeModal('reinit-mdp'); sessionStorage.removeItem('helixcar_reinit_en_cours');
      window._hcRolesAutorises = ['client']; window._hcRoleActif = 'client';
      window.__journal = [];
      doLogout();
      const immediat = { signOutFini: window.__journal.some(j => j.op === 'signOut'),
                         ecran: document.getElementById('login-screen').style.display };
      await new Promise(r => setTimeout(r, 150));
      return { immediat, actif: window._hcRoleActif, roles: window._hcRolesAutorises.slice(),
               dernier: window._dernierAuthUserTraite };
    });
    check('A4 : REPRODUCTION (origin/main) — la déconnexion réaffiche l\'écran AVANT que la session soit fermée, et garde le rôle actif',
      apresLogout.immediat.ecran === 'flex' && apresLogout.immediat.signOutFini === false
      && apresLogout.actif === 'client', JSON.stringify(apresLogout));
    await page.close();
  } else {
    console.log('A1-A4 : reproduction sur origin/main non exécutée (historique git indisponible)');
  }
  if (ancienIdx) {
    const page = await ouvrir(navigateur, 'file://' + ancienIdx);
    const persistance = await page.evaluate(() => {
      openModal('connexion');
      _hcNote('connexion-message', 'TEST-QA-CLAUDE-HELIXCAR message précédent', 'info');
      closeModal('connexion');
      openModal('connexion');
      const m = document.getElementById('connexion-message');
      return { texte: m.textContent, visible: m.classList.contains('visible') };
    });
    check('A5 : REPRODUCTION (origin/main) — le message de la fenêtre « Connexion » survit à sa fermeture et à sa réouverture',
      persistance.visible === true && /message précédent/.test(persistance.texte), JSON.stringify(persistance));
    const bascule = await page.evaluate(() => {
      closeModal('connexion');
      const type = document.getElementById('client-type');
      type.value = 'pro'; toggleClientType();
      document.getElementById('client-societe').value = 'TEST-QA-CLAUDE-HELIXCAR SAS';
      document.getElementById('client-siret').value = '12345678901234';
      type.value = 'particulier'; toggleClientType();
      return { societe: document.getElementById('client-societe').value,
               siret: document.getElementById('client-siret').value };
    });
    check('A6 : REPRODUCTION (origin/main) — revenir sur « Particulier » garde la société et le SIRET saisis',
      bascule.societe !== '' && bascule.siret !== '', JSON.stringify(bascule));
    await page.close();
  }

  // ══ B. LE DASHBOARD N'A PLUS DE FORMULAIRE : UN ÉCRAN D'ATTENTE NEUTRE ══
  {
    const page = await ouvrir(navigateur, urlFichier('dashboard.html'), ['client']);
    const ecran = await page.evaluate(() => ({
      onglets: document.querySelectorAll('.login-tab').length,
      champs: document.querySelectorAll('#login-screen input, #login-screen button').length,
      visible: getComputedStyle(document.getElementById('login-screen')).display !== 'none',
      titre: (document.getElementById('attente-titre') || {}).textContent || '',
      lienVisible: (document.getElementById('attente-lien') || {}).style.display !== 'none',
      appVisible: document.getElementById('app').classList.contains('visible')
    }));
    check('B1 : plus aucun onglet de rôle ni champ de saisie dans le Dashboard',
      ecran.onglets === 0 && ecran.champs === 0, JSON.stringify(ecran));
    check('B2 : un écran d\'attente neutre est affiché, sans lien tant que rien n\'est décidé',
      ecran.visible && /Ouverture de votre espace/.test(ecran.titre) && ecran.lienVisible === false
      && ecran.appVisible === false, JSON.stringify(ecran));
    const dashSansCommentaires = dash.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    check('B3 : le code ne contient plus setLoginRole / doLogin / ouvrirMotDePasseOublie',
      !/setLoginRole|doLogin\b|doLoginClient|doLoginAdmin|doLoginConvoyeur|ouvrirMotDePasseOublie|login-tab/.test(dashSansCommentaires));

    // Sans session : retour au site public, jamais une page muette.
    const sansSession = await page.evaluate(async () => {
      window.__emettre('INITIAL_SESSION', null);
      await new Promise(r => setTimeout(r, 50));
      return { retours: window.__retours.slice(), appVisible: document.getElementById('app').classList.contains('visible') };
    });
    check('B4 : sans session, le Dashboard renvoie à la fenêtre « Connexion » du site',
      sansSession.retours.length === 1 && sansSession.retours[0] === '' && sansSession.appVisible === false,
      JSON.stringify(sansSession));
    check('B5 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ C. AVEC UNE SESSION, L'ESPACE CONFIRMÉ PAR LE SERVEUR S'OUVRE ══
  {
    const page = await ouvrir(navigateur, urlFichier('dashboard.html'), ['client']);
    const ouvert = await page.evaluate(async () => {
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 300));
      return {
        appVisible: document.getElementById('app').classList.contains('visible'),
        ecranCache: getComputedStyle(document.getElementById('login-screen')).display === 'none',
        actif: window._hcRoleActif, roles: window._hcRolesAutorises.slice(),
        retours: window.__retours.slice(),
        rpc: window.__journal.filter(j => j.op === 'rpc').map(j => j.nom)
      };
    });
    check('C1 : la session ouvre l\'espace que le serveur confirme, sans choix de rôle',
      ouvert.appVisible && ouvert.ecranCache && ouvert.actif === 'client' && ouvert.rpc.indexOf('roles_utilisateur') !== -1,
      JSON.stringify(ouvert));
    check('C2 : et aucun retour au site n\'est déclenché', ouvert.retours.length === 0, JSON.stringify(ouvert.retours));

    // ── Déconnexion : tout est remis à zéro, la session est fermée AVANT le retour.
    const logout = await page.evaluate(async () => {
      window.__journal = [];
      const p = doLogout();
      const pendant = { retours: window.__retours.slice(), signOut: window.__journal.some(j => j.op === 'signOut') };
      await p;
      return {
        pendant,
        retours: window.__retours.slice(),
        signOut: window.__journal.some(j => j.op === 'signOut'),
        actif: window._hcRoleActif, roles: window._hcRolesAutorises.slice(),
        dernier: window._dernierAuthUserTraite,
        selecteur: document.getElementById('sb-roles').innerHTML,
        mobileNav: document.getElementById('mobile-bottom-nav').style.display,
        appVisible: document.getElementById('app').classList.contains('visible'),
        ecranVisible: getComputedStyle(document.getElementById('login-screen')).display !== 'none'
      };
    });
    check('C3 : la déconnexion ATTEND la fermeture de session avant de renvoyer au site',
      logout.pendant.retours.length === 0 && logout.pendant.signOut === false
      && logout.signOut === true && logout.retours.length === 1 && logout.retours[0] === 'deconnecte',
      JSON.stringify(logout));
    check('C4 : rôles, sélecteur, barre mobile et dernier utilisateur sont remis à zéro',
      logout.actif === null && logout.roles.length === 0 && logout.dernier === null
      && logout.selecteur === '' && logout.mobileNav === 'none' && logout.appVisible === false
      && logout.ecranVisible === true, JSON.stringify(logout));

    // Une reconnexion sous une autre identité dans le même onglet repart de zéro.
    const autre = await page.evaluate(async () => {
      window.__roles = ['admin'];
      window.__uid = '77777777-0000-0000-0000-00000000a002';
      window.__session = { access_token: 'jwt2', user: { id: window.__uid, email: 'a01-admin@helixcar.test' } };
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 300));
      return { actif: window._hcRoleActif, appVisible: document.getElementById('app').classList.contains('visible') };
    });
    check('C5 : une autre identité, ensuite, ouvre SON espace — rien de l\'ancienne ne subsiste',
      autre.actif === 'admin' && autre.appVisible === true, JSON.stringify(autre));
    check('C6 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ D. LA RÉCUPÉRATION : ATTEIGNABLE, ISOLÉE, CONSOMMÉE ══
  {
    const page = await ouvrir(navigateur, urlFichier('dashboard.html'), ['client']);
    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY', window.__session));
    await page.waitForTimeout(150);
    const recup = await page.evaluate(ATTEIGNABLE);
    check('D1 : la fenêtre « Nouveau mot de passe » est ouverte ET atteignable au-dessus de l\'écran d\'attente',
      recup.ouverte === true && recup.atteignable === true, JSON.stringify(recup));
    const drapeau = await page.evaluate(() => ({
      drapeau: sessionStorage.getItem('helixcar_reinit_en_cours'),
      uid: sessionStorage.getItem('helixcar_reinit_uid')
    }));
    check('D2 : le drapeau de reprise porte l\'identité de la session de récupération',
      drapeau.drapeau === '1' && drapeau.uid === '77777777-0000-0000-0000-00000000a001', JSON.stringify(drapeau));

    // Pendant le choix du mot de passe, aucun espace ne s'ouvre.
    const pendant = await page.evaluate(async () => {
      window.__emettre('INITIAL_SESSION', window.__session);
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 250));
      return { appVisible: document.getElementById('app').classList.contains('visible'),
               ouverte: document.getElementById('modal-reinit-mdp').classList.contains('open') };
    });
    check('D3 : tant que le mot de passe n\'est pas choisi, la session de récupération n\'ouvre AUCUN espace',
      pendant.appVisible === false && pendant.ouverte === true, JSON.stringify(pendant));

    // Un clic à côté ne ferme pas la fenêtre (sortie explicite seulement).
    const clicExterieur = await page.evaluate(() => {
      const o = document.getElementById('modal-reinit-mdp');
      o.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return o.classList.contains('open');
    });
    check('D4 : un clic hors de la fenêtre ne la ferme pas — on en sort par « Annuler » ou par le succès',
      clicExterieur === true);

    // F5 : la MÊME session reprend le formulaire ; une AUTRE identité, non.
    const reprise = await page.evaluate(async () => {
      closeModal('reinit-mdp');
      const apresFermeture = sessionStorage.getItem('helixcar_reinit_en_cours');
      sessionStorage.setItem('helixcar_reinit_en_cours', '1');
      sessionStorage.setItem('helixcar_reinit_uid', window.__uid);
      window.__emettre('INITIAL_SESSION', window.__session);
      await new Promise(r => setTimeout(r, 100));
      const memeSession = document.getElementById('modal-reinit-mdp').classList.contains('open');
      closeModal('reinit-mdp');
      sessionStorage.setItem('helixcar_reinit_en_cours', '1');
      sessionStorage.setItem('helixcar_reinit_uid', 'autre-identite');
      window._dernierAuthUserTraite = null;
      window.__emettre('INITIAL_SESSION', window.__session);
      await new Promise(r => setTimeout(r, 300));
      return { apresFermeture, memeSession,
               autreIdentite: document.getElementById('modal-reinit-mdp').classList.contains('open'),
               espaceOuvert: document.getElementById('app').classList.contains('visible') };
    });
    check('D5 : fermer la fenêtre efface le drapeau', reprise.apresFermeture === null, String(reprise.apresFermeture));
    check('D6 : après un F5, la MÊME session retrouve le formulaire', reprise.memeSession === true);
    check('D7 : un drapeau d\'une AUTRE identité est ignoré : l\'espace s\'ouvre normalement',
      reprise.autreIdentite === false && reprise.espaceOuvert === true, JSON.stringify(reprise));

    // Une connexion normale n'honore JAMAIS un drapeau abandonné.
    const normale = await page.evaluate(async () => {
      document.getElementById('app').classList.remove('visible');
      window._dernierAuthUserTraite = null;
      sessionStorage.setItem('helixcar_reinit_en_cours', '1');
      sessionStorage.setItem('helixcar_reinit_uid', window.__uid);
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 300));
      return { rouverte: document.getElementById('modal-reinit-mdp').classList.contains('open'),
               drapeau: sessionStorage.getItem('helixcar_reinit_en_cours'),
               espaceOuvert: document.getElementById('app').classList.contains('visible') };
    });
    check('D8 : une connexion normale (SIGNED_IN) ne rouvre pas le formulaire et efface le drapeau',
      normale.rouverte === false && normale.drapeau === null && normale.espaceOuvert === true, JSON.stringify(normale));
    check('D9 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ E. SORTIES DU PARCOURS : ANNULER, OU SUCCÈS ══
  {
    const page = await ouvrir(navigateur, urlFichier('dashboard.html'), ['client']);
    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY', window.__session));
    await page.waitForTimeout(100);
    const annule = await page.evaluate(async () => {
      window.__journal = [];
      document.getElementById('reinit-annuler').click();
      await new Promise(r => setTimeout(r, 200));
      return { fermee: !document.getElementById('modal-reinit-mdp').classList.contains('open'),
               drapeau: sessionStorage.getItem('helixcar_reinit_en_cours'),
               signOut: window.__journal.some(j => j.op === 'signOut'),
               retours: window.__retours.slice() };
    });
    check('E1 : « Annuler » ferme la session de récupération et renvoie au site, mot de passe inchangé',
      annule.fermee && annule.drapeau === null && annule.signOut && annule.retours.slice(-1)[0] === 'mdp-inchange',
      JSON.stringify(annule));

    const succes = await page.evaluate(async () => {
      window.__retours = []; window.__journal = [];
      window.__emettre('PASSWORD_RECOVERY', window.__session);
      document.getElementById('reinit-mdp').value = 'NouveauMdpTestQA1';
      document.getElementById('reinit-mdp2').value = 'NouveauMdpTestQA1';
      await enregistrerNouveauMotDePasse();
      const apresEnregistrement = sessionStorage.getItem('helixcar_reinit_en_cours');
      await terminerReinitialisation();
      return { apresEnregistrement,
               fermee: !document.getElementById('modal-reinit-mdp').classList.contains('open'),
               signOut: window.__journal.some(j => j.op === 'signOut'),
               retours: window.__retours.slice() };
    });
    check('E2 : le succès consomme le drapeau, ferme la session et renvoie à la connexion du site',
      succes.apresEnregistrement === null && succes.fermee && succes.signOut && succes.retours.slice(-1)[0] === 'mdp-modifie',
      JSON.stringify(succes));
    check('E3 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ F. LA GARDE PRÉCOCE : LIEN PÉRIMÉ, FRAGMENT DE RÉCUPÉRATION ══
  {
    const page = await navigateur.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.addInitScript(INIT);
    const destinations = [];
    page.on('framenavigated', f => { try { destinations.push(f.url()); } catch (e) {} });
    await page.goto(urlFichier('dashboard.html') + '#error_code=otp_expired&error=access_denied', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    check('F1 : un lien périmé arrivant sur le Dashboard est renvoyé au site, fragment conservé',
      destinations.some(u => /index\.html#error_code=otp_expired/.test(u)), JSON.stringify(destinations.slice(-3)));
    await page.close();

    const page2 = await ouvrir(navigateur, urlFichier('dashboard.html') + '#access_token=x&type=recovery', ['client']);
    const attendu = await page2.evaluate(async () => {
      const memorise = window._hcRecuperationAttendue === true;
      // La bibliothèque établit la session du lien, et émet SIGNED_IN
      // avant PASSWORD_RECOVERY (ou sans lui) : l'espace ne doit pas s'ouvrir.
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 250));
      return { memorise,
               formulaire: document.getElementById('modal-reinit-mdp').classList.contains('open'),
               appVisible: document.getElementById('app').classList.contains('visible') };
    });
    check('F2 : un fragment de récupération est mémorisé avant sa consommation, et la session qui suit ouvre le formulaire, pas l\'espace',
      attendu.memorise && attendu.formulaire === true && attendu.appVisible === false, JSON.stringify(attendu));
    await page2.close();

    const page3 = await ouvrir(navigateur, urlFichier('dashboard.html') + '#type=recovery', ['client']);
    const sansSession = await page3.evaluate(async () => {
      window.__emettre('INITIAL_SESSION', null);
      await new Promise(r => setTimeout(r, 50));
      return { titre: document.getElementById('attente-titre').textContent,
               lienVisible: document.getElementById('attente-lien').style.display !== 'none',
               retours: window.__retours.slice() };
    });
    check('F3 : un fragment de récupération SANS session est dit invalide, avec un lien vers la connexion, sans boucle de redirection',
      /plus valide/.test(sansSession.titre) && sansSession.lienVisible && sansSession.retours.length === 0,
      JSON.stringify(sansSession));
    await page3.close();
  }

  // ══ G. DEUX CASQUETTES : LE SÉLECTEUR EXISTE AUSSI SUR MOBILE ══
  {
    const page = await ouvrir(navigateur, urlFichier('dashboard.html'), ['client', 'partenaire']);
    await page.setViewportSize({ width: 390, height: 800 });
    const menu = await page.evaluate(async () => {
      window.__emettre('SIGNED_IN', window.__session);
      await new Promise(r => setTimeout(r, 350));
      openMobileMenu();
      const bloc = document.getElementById('mobile-menu-roles');
      const boutons = bloc ? Array.prototype.slice.call(bloc.querySelectorAll('button')) : [];
      return {
        present: !!bloc,
        libelles: boutons.map(b => b.textContent),
        courant: boutons.filter(b => b.getAttribute('aria-current') === 'true').map(b => b.getAttribute('data-hc-role')),
        lateral: Array.prototype.slice.call(document.querySelectorAll('#sb-roles button')).map(b => b.textContent)
      };
    });
    check('G1 : le menu mobile propose les mêmes espaces que la barre latérale',
      menu.present && JSON.stringify(menu.libelles) === JSON.stringify(menu.lateral) && menu.libelles.length === 2,
      JSON.stringify(menu));
    // L'ordre d'ouverture par défaut (admin, partenaire, client) est
    // inchangé : avec client + partenaire, c'est l'espace partenaire qui
    // s'ouvre d'abord, et le menu le marque comme courant.
    check('G2 : les libellés sont « Espace client » et « Espace partenaire », et l\'espace ouvert est marqué courant',
      menu.libelles.indexOf('Espace client') !== -1 && menu.libelles.indexOf('Espace partenaire') !== -1
      && JSON.stringify(menu.courant) === JSON.stringify(['partenaire']), JSON.stringify(menu));
    const bascule = await page.evaluate(async () => {
      const b = document.querySelector('#mobile-menu-roles button[data-hc-role="client"]');
      b.click();
      await new Promise(r => setTimeout(r, 350));
      return { actif: window._hcRoleActif,
               menuFerme: document.getElementById('mobile-menu-overlay').style.display === 'none',
               reconnexion: window.__journal.some(j => j.op === 'signIn'),
               titreNav: (document.querySelector('#sidebar-nav .nav-section-label') || {}).textContent || '' };
    });
    check('G3 : un tap change d\'espace (partenaire → client), ferme le menu, sans aucune reconnexion',
      bascule.actif === 'client' && bascule.menuFerme && bascule.reconnexion === false
      && /Espace client/.test(bascule.titreNav), JSON.stringify(bascule));
    check('G4 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ H. LE SITE : LA FENÊTRE « CONNEXION » ACCUEILLE LES RETOURS DU DASHBOARD ══
  {
    const cas = [
      ['#connexion=mdp-modifie', /mot de passe a bien été modifié/, 'succes'],
      ['#connexion=deconnecte', /déconnecté/, 'info'],
      ['#connexion=mdp-inchange', /n'a pas été modifié/, 'info'],
      ['#connexion', null, null]
    ];
    let i = 1;
    for (const [hash, attendu, ton] of cas) {
      const page = await ouvrir(navigateur, urlFichier('index.html') + hash);
      await page.waitForTimeout(300);
      const etat = await page.evaluate(() => {
        const m = document.getElementById('connexion-message');
        return { ouverte: document.getElementById('modal-connexion').classList.contains('open'),
                 texte: m.textContent, classes: m.className, hash: window.location.hash };
      });
      const ok = etat.ouverte && etat.hash === ''
        && (attendu ? (attendu.test(etat.texte) && etat.classes.indexOf('hc-note--' + ton) !== -1) : etat.texte === '');
      check('H' + i + ' : ' + hash + ' ouvre la fenêtre « Connexion »' + (attendu ? ' avec la phrase attendue' : ' sans message')
        + ', et retire le fragment', ok, JSON.stringify(etat));
      check('H' + i + 'b : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
      await page.close();
      i++;
    }

    // Le message ne survit ni à la fermeture ni à la réouverture.
    const page = await ouvrir(navigateur, urlFichier('index.html'));
    const nettoyage = await page.evaluate(() => {
      openModal('connexion');
      _hcNote('connexion-message', 'TEST-QA-CLAUDE-HELIXCAR message précédent', 'info');
      closeModal('connexion');
      const apresFermeture = document.getElementById('connexion-message').textContent;
      _hcNote('connexion-message', 'TEST-QA-CLAUDE-HELIXCAR encore', 'info');
      openModal('connexion');
      return { apresFermeture, apresOuverture: document.getElementById('connexion-message').textContent };
    });
    check('H5 : le message de la fenêtre « Connexion » est effacé à la fermeture ET à l\'ouverture',
      nettoyage.apresFermeture === '' && nettoyage.apresOuverture === '', JSON.stringify(nettoyage));

    // Professionnel → Particulier : la société et le SIRET ne suivent pas.
    const bascule = await page.evaluate(() => {
      closeModal('connexion');
      const type = document.getElementById('client-type');
      type.value = 'pro'; toggleClientType();
      document.getElementById('client-societe').value = 'TEST-QA-CLAUDE-HELIXCAR SAS';
      document.getElementById('client-siret').value = '12345678901234';
      type.value = 'particulier'; toggleClientType();
      return { societe: document.getElementById('client-societe').value,
               siret: document.getElementById('client-siret').value };
    });
    check('H6 : revenir sur « Particulier » vide la société et le SIRET',
      bascule.societe === '' && bascule.siret === '', JSON.stringify(bascule));
    check('H7 : et le payload les force à null hors « Professionnel », partout où il est construit',
      (idx.match(/societe:\s+type_val === 'pro' \? \(societe_val \|\| null\) : null/g) || []).length === 3
      && (idx.match(/siret:\s+type_val === 'pro' \? \(siret_val \|\| null\) : null/g) || []).length === 3
      && !/societe:\s+societe_val \|\| null/.test(idx));
    check('H8 : la connexion depuis le site efface tout drapeau de récupération AVANT d\'ouvrir l\'espace',
      /_hcEffacerDrapeauReinit\(\);\s*\n\s*window\.location\.href = 'dashboard\.html';/.test(idx));
    check('H9 : sur le site aussi, un drapeau n\'est honoré qu\'à la reprise, jamais à une connexion normale',
      /evenement === 'INITIAL_SESSION' && aSession && _hcReinitEnCoursPour\(session\)/.test(idx)
      && /if \(evenement === 'SIGNED_IN'\) _hcEffacerDrapeauReinit\(\);/.test(idx));
    check('H10 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ I. CE QUI EST ANNONCÉ EST CE QUI S'EST PASSÉ ══
  check('I1 : « Votre compte HelixCar est maintenant créé » n\'accompagne QUE l\'issue « cree »',
    /_compteEtat === 'cree'\) \{\s*html \+= '<div class="hc-succes-txt">Votre compte HelixCar est maintenant créé/.test(idx)
    && (idx.match(/hc-succes-txt">Votre compte HelixCar est maintenant créé/g) || []).length === 1);
  check('I2 : un compte existant et un dépôt déjà connecté ont chacun leur phrase, honnête',
    /_compteEtat === 'existe_deja'\) \{\s*html \+= '<div class="hc-succes-txt">Vous avez déjà un compte HelixCar/.test(idx)
    && /_compteEtat === 'non_demande' && _idCompteDepot\) \{/.test(idx));

  // ══ J. LES TROIS PAGES, MÊME SOIN ══
  check('J1 : aucun doublon de bouton œil sous Edge (::-ms-reveal masqué) sur les trois pages',
    /input::-ms-reveal, input::-ms-clear \{ display: none; \}/.test(dash)
    && /input::-ms-reveal, input::-ms-clear \{ display: none; \}/.test(idx)
    && /input::-ms-reveal, input::-ms-clear \{ display: none; \}/.test(cc));
  check('J2 : l\'autoremplissage est neutralisé sur la page de création de compte partenaire',
    /input:-webkit-autofill[\s\S]{0,200}background-clip: text/.test(cc));
  check('J3 : la fenêtre « Nouveau mot de passe » passe au-dessus de l\'écran d\'attente',
    /#modal-reinit-mdp \{ z-index: 1000; \}/.test(dash));
  check('J4 : « Mot de passe oublié ? » vit sur le site, dans la fenêtre « Connexion »',
    /demanderReinitialisationMotDePasse/.test(idx) && (dash.match(/auth\.resetPasswordForEmail\(/g) || []).length === 1);
  check('J5 : aucun mot de passe ni jeton n\'est journalisé par le nouveau code',
    !/console\.(log|warn|error)\([^)]*(mdp|password|access_token)/i.test(dash.slice(dash.indexOf('function _hcMemoriserReinit'), dash.indexOf('function _hcMemoriserReinit') + 6000)));

  try { if (ancienDash) fs.unlinkSync(ancienDash); } catch (e) {}
  try { if (ancienIdx) fs.unlinkSync(ancienIdx); } catch (e) {}
  await navigateur.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
