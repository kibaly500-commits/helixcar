// RÉINITIALISATION DU MOT DE PASSE
// Exécute le vrai code des deux pages contre un double Supabase Auth.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}

// Double Supabase Auth. Il journalise TOUT et permet de simuler les
// situations réelles : adresse inconnue, limitation d'envoi, coupure
// réseau, lien expiré ou déjà utilisé.
const INIT = `
window.__journal = [];
window.__emails = [];
window.__comptes = { 'connu@helixcar.test': 'ancienMotDePasse1' };
window.__modeEnvoi = 'ok';        // ok | limite | reseau
window.__modeUpdate = 'ok';       // ok | expire | reseau
window.__session = null;

window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function (cb) {
      window.__declencher = cb;
      return { data: { subscription: { unsubscribe: function () {} } } };
    },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function (id) {
      window.__journal.push({ op: 'signIn', email: id && id.email, mdp: id && id.password });
      const attendu = window.__comptes[id.email];
      if (attendu && attendu === id.password) {
        window.__session = { access_token: 'jwt', user: { id: 'u-1', email: id.email } };
        return { data: { session: window.__session, user: window.__session.user }, error: null };
      }
      return { data: null, error: { message: 'Invalid login credentials' } };
    },
    signUp: async function () { return { data: { user: { id: 'u-2' } }, error: null }; },
    signOut: async function () { window.__journal.push({ op: 'signOut' }); window.__session = null; return {}; },
    resetPasswordForEmail: async function (email, options) {
      window.__journal.push({ op: 'reset', email: email, redirectTo: options && options.redirectTo });
      if (window.__modeEnvoi === 'reseau') throw new Error('Failed to fetch');
      if (window.__modeEnvoi === 'limite') {
        return { data: null, error: { status: 429, message: 'For security purposes, you can only request this after 51 seconds.' } };
      }
      // Supabase ne distingue JAMAIS une adresse connue d'une inconnue.
      return { data: {}, error: null };
    },
    updateUser: async function (attrs) {
      window.__journal.push({ op: 'updateUser', aMotDePasse: !!(attrs && attrs.password) });
      if (window.__modeUpdate === 'reseau') throw new Error('Failed to fetch');
      if (window.__modeUpdate === 'expire') {
        return { data: null, error: { message: 'Auth session missing or expired' } };
      }
      // Le nouveau mot de passe remplace l'ancien pour le compte courant.
      const courriel = (window.__session && window.__session.user && window.__session.user.email) || 'connu@helixcar.test';
      window.__comptes[courriel] = attrs.password;
      return { data: { user: { id: 'u-1' } }, error: null };
    }
  },
  from: function () { return {
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    then(r) { return Promise.resolve({ data: [], error: null }).then(r); }
  }; },
  rpc: async function () { return { data: [], error: null }; },
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: null }; } }; } }
}; } };

window.emailjs = { init: function () {},
  send: function () { window.__emails.push(Array.from(arguments)); return Promise.resolve(); },
  sendForm: function () { window.__emails.push(['f']); return Promise.resolve(); } };
`;

(async () => {
  const navigateur = await lancerNavigateur();
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1000 } });
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);

  // ── A. DEMANDE DEPUIS LE SITE PUBLIC ──
  await page.goto(urlFichier('index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(200);

  const lien = await page.evaluate(() => {
    const a = document.querySelector('#modal-connexion .hc-forgot-link');
    return a ? a.getAttribute('onclick') : '';
  });
  check('A1 : le lien ne déclenche PLUS une connexion',
    !/submitConnexionForm/.test(lien) && /demanderReinitialisationMotDePasse/.test(lien), lien);

  const sansAdresse = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('connexion-email').value = '';
    await demanderReinitialisationMotDePasse();
    return {
      message: (document.getElementById('connexion-message') || {}).textContent || '',
      appels: window.__journal.filter(j => j.op === 'reset').length
    };
  });
  check('A2 : sans adresse, rien n\'est envoyé',
    sansAdresse.appels === 0 && /Renseignez votre adresse/.test(sansAdresse.message), JSON.stringify(sansAdresse));

  const invalide = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('connexion-email').value = 'pas-une-adresse';
    await demanderReinitialisationMotDePasse();
    return {
      message: (document.getElementById('connexion-message') || {}).textContent || '',
      appels: window.__journal.filter(j => j.op === 'reset').length
    };
  });
  check('A3 : adresse invalide -> aucun envoi, message clair',
    invalide.appels === 0 && /n'est pas valide/.test(invalide.message), JSON.stringify(invalide));

  const connue = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('connexion-email').value = 'connu@helixcar.test';
    await demanderReinitialisationMotDePasse();
    return {
      message: (document.getElementById('connexion-message') || {}).textContent || '',
      appel: window.__journal.filter(j => j.op === 'reset')[0] || null,
      connexions: window.__journal.filter(j => j.op === 'signIn').length
    };
  });
  check('A4 : adresse existante -> vraie fonction Supabase appelée',
    !!connue.appel && connue.appel.email === 'connu@helixcar.test', JSON.stringify(connue.appel));
  check('A5 : AUCUNE tentative de connexion n\'est faite', connue.connexions === 0, String(connue.connexions));
  check('A6 : le lien de retour pointe vers une page du projet',
    !!connue.appel && /dashboard\.html$/.test(connue.appel.redirectTo || ''), String(connue.appel && connue.appel.redirectTo));
  const messageNeutre = connue.message;
  check('A7 : message neutre affiché',
    /Si un compte correspond à cette adresse/.test(messageNeutre), messageNeutre);

  const inconnue = await page.evaluate(async () => {
    document.getElementById('connexion-email').value = 'inconnu@helixcar.test';
    await demanderReinitialisationMotDePasse();
    return (document.getElementById('connexion-message') || {}).textContent || '';
  });
  check('A8 : adresse inexistante -> message EXACTEMENT identique',
    inconnue === messageNeutre, inconnue);

  const doubleClic = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('connexion-email').value = 'connu@helixcar.test';
    demanderReinitialisationMotDePasse();
    demanderReinitialisationMotDePasse();
    await new Promise(r => setTimeout(r, 400));
    return window.__journal.filter(j => j.op === 'reset').length;
  });
  check('A9 : un double clic n\'envoie qu\'UN seul lien', doubleClic === 1, 'envois=' + doubleClic);

  const limite = await page.evaluate(async () => {
    window.__modeEnvoi = 'limite';
    document.getElementById('connexion-email').value = 'connu@helixcar.test';
    await demanderReinitialisationMotDePasse();
    window.__modeEnvoi = 'ok';
    return (document.getElementById('connexion-message') || {}).textContent || '';
  });
  check('A10 : limitation d\'envoi annoncée sans révéler l\'existence du compte',
    /Trop de demandes/.test(limite) && !/compte existe|aucun compte/i.test(limite), limite);

  const reseau = await page.evaluate(async () => {
    window.__modeEnvoi = 'reseau';
    document.getElementById('connexion-email').value = 'connu@helixcar.test';
    await demanderReinitialisationMotDePasse();
    window.__modeEnvoi = 'ok';
    return (document.getElementById('connexion-message') || {}).textContent || '';
  });
  check('A11 : coupure réseau -> aucun faux succès',
    !/vient d'être envoyé/.test(reseau) && /n'a pas abouti/.test(reseau), reseau);

  check('A12 : aucun mot de passe n\'est saisi sur le site public à cette étape',
    await page.evaluate(() => window.__journal.every(j => !j.mdp)));

  // ── B. NOUVEAU MOT DE PASSE, SUR LA PAGE D'ARRIVÉE ──
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const ouverture = await page.evaluate(() => {
    window.__session = { access_token: 'jwt', user: { id: 'u-1', email: 'connu@helixcar.test' } };
    window.__declencher('PASSWORD_RECOVERY', window.__session);
    return {
      ouverte: document.getElementById('modal-reinit-mdp').classList.contains('open'),
      champs: ['reinit-mdp', 'reinit-mdp2'].map(i => !!document.getElementById(i)),
      types: ['reinit-mdp', 'reinit-mdp2'].map(i => (document.getElementById(i) || {}).type)
    };
  });
  check('B1 : un lien valide ouvre le formulaire « Nouveau mot de passe »', ouverture.ouverte);
  check('B2 : deux champs distincts, masqués',
    ouverture.champs.every(Boolean) && ouverture.types.every(t => t === 'password'), JSON.stringify(ouverture));

  const differents = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('reinit-mdp').value = 'MotDePasse1';
    document.getElementById('reinit-mdp2').value = 'MotDePasse2';
    await enregistrerNouveauMotDePasse();
    return {
      alerte: (document.getElementById('reinit-alert') || {}).textContent || '',
      appels: window.__journal.filter(j => j.op === 'updateUser').length
    };
  });
  check('B3 : deux mots de passe différents -> refus, aucun enregistrement',
    differents.appels === 0 && /ne sont pas identiques/.test(differents.alerte), JSON.stringify(differents));

  const tropCourt = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('reinit-mdp').value = 'court';
    document.getElementById('reinit-mdp2').value = 'court';
    await enregistrerNouveauMotDePasse();
    return {
      alerte: (document.getElementById('reinit-alert') || {}).textContent || '',
      appels: window.__journal.filter(j => j.op === 'updateUser').length
    };
  });
  check('B4 : règle de longueur du projet appliquée',
    tropCourt.appels === 0 && /au moins 8 caractères/.test(tropCourt.alerte), JSON.stringify(tropCourt));

  const expire = await page.evaluate(async () => {
    window.__modeUpdate = 'expire';
    document.getElementById('reinit-mdp').value = 'NouveauMdp2026';
    document.getElementById('reinit-mdp2').value = 'NouveauMdp2026';
    await enregistrerNouveauMotDePasse();
    window.__modeUpdate = 'ok';
    return (document.getElementById('reinit-alert') || {}).textContent || '';
  });
  check('B5 : lien expiré ou déjà utilisé -> message explicite et sortie propre',
    /n'est plus valide/.test(expire) && /nouveau lien/.test(expire), expire);

  const reseau2 = await page.evaluate(async () => {
    window.__modeUpdate = 'reseau';
    document.getElementById('reinit-mdp').value = 'NouveauMdp2026';
    document.getElementById('reinit-mdp2').value = 'NouveauMdp2026';
    await enregistrerNouveauMotDePasse();
    window.__modeUpdate = 'ok';
    return {
      alerte: (document.getElementById('reinit-alert') || {}).textContent || '',
      succesVisible: (document.getElementById('reinit-succes') || {}).style.display
    };
  });
  check('B6 : coupure réseau -> aucun faux succès',
    /n'a pas abouti/.test(reseau2.alerte) && reseau2.succesVisible !== '', JSON.stringify(reseau2));

  const doubleClic2 = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('reinit-mdp').value = 'NouveauMdp2026';
    document.getElementById('reinit-mdp2').value = 'NouveauMdp2026';
    enregistrerNouveauMotDePasse();
    enregistrerNouveauMotDePasse();
    await new Promise(r => setTimeout(r, 400));
    return {
      appels: window.__journal.filter(j => j.op === 'updateUser').length,
      succesVisible: (document.getElementById('reinit-succes') || {}).style.display,
      formulaireVisible: (document.getElementById('reinit-formulaire') || {}).style.display
    };
  });
  check('B7 : double clic -> un seul enregistrement', doubleClic2.appels === 1, 'appels=' + doubleClic2.appels);
  check('B8 : réussite confirmée à l\'écran',
    doubleClic2.succesVisible === '' && doubleClic2.formulaireVisible === 'none', JSON.stringify(doubleClic2));

  check('B9 : le mot de passe part UNIQUEMENT vers Supabase Auth',
    await page.evaluate(() => window.__journal.every(j => j.op !== 'updateUser' || j.aMotDePasse === true)));

  // ── C. F5 PENDANT LE PARCOURS ──
  const apresF5 = await page.evaluate(async () => {
    // On rejoue ce que fait le navigateur après un rechargement :
    // PASSWORD_RECOVERY n'est pas rejoué, seule INITIAL_SESSION l'est.
    sessionStorage.setItem('helixcar_reinit_en_cours', '1');
    closeModal('reinit-mdp');
    window.__declencher('INITIAL_SESSION', window.__session);
    await new Promise(r => setTimeout(r, 200));
    return {
      ouverte: document.getElementById('modal-reinit-mdp').classList.contains('open'),
      role: typeof currentRole !== 'undefined' ? currentRole : null
    };
  });
  check('C1 : après F5, le formulaire revient au lieu d\'ouvrir l\'espace',
    apresF5.ouverte === true, JSON.stringify(apresF5));

  // ── D. LE NOUVEAU MOT DE PASSE FONCTIONNE, L'ANCIEN NON ──
  const connexions = await page.evaluate(async () => {
    sessionStorage.removeItem('helixcar_reinit_en_cours');
    const ancien = await sbAuth.auth.signInWithPassword({
      email: 'connu@helixcar.test', password: 'ancienMotDePasse1' });
    const nouveau = await sbAuth.auth.signInWithPassword({
      email: 'connu@helixcar.test', password: 'NouveauMdp2026' });
    return { ancienOk: !ancien.error, nouveauOk: !nouveau.error };
  });
  check('D1 : l\'ancien mot de passe est REFUSÉ après modification', connexions.ancienOk === false);
  check('D2 : le nouveau mot de passe est accepté', connexions.nouveauOk === true);

  const retour = await page.evaluate(async () => {
    window.__journal = [];
    await terminerReinitialisation();
    return {
      fermee: !document.getElementById('modal-reinit-mdp').classList.contains('open'),
      deconnexion: window.__journal.some(j => j.op === 'signOut'),
      ecranConnexion: (document.getElementById('login-screen') || {}).style.display
    };
  });
  check('D3 : retour vers la connexion normale',
    retour.fermee && retour.deconnexion && retour.ecranConnexion === 'flex', JSON.stringify(retour));

  // ── E. GARDE-FOUS ──
  check('E1 : aucun e-mail EmailJS déclenché par ce parcours',
    await page.evaluate(() => window.__emails.length) === 0);

  const fs = require('fs');
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  // Ce qui compte n'est pas la présence du mot « password » — les appels
  // Supabase Auth en contiennent forcément — mais que la SEULE
  // destination du mot de passe soit auth.*, et jamais le payload d'une
  // demande ni une table.
  const destinationsMdp = (idx.match(/password:\s*[A-Za-z_$][\w$]*/g) || []);
  const appelsAuth = (idx.match(/auth\.(signUp|signInWithPassword|updateUser)\(/g) || []).length;
  check('E2 : le mot de passe ne va QUE vers Supabase Auth, jamais dans un payload',
    destinationsMdp.length > 0 && destinationsMdp.length <= appelsAuth
    && !/payload\.[a-z_]*(password|mot_de_passe)/i.test(idx)
    && !/(mot_de_passe|password)\s*:\s*(mdp|password|motDePasse)/i.test(idx.replace(/auth\.[\s\S]{0,120}?\)/g, '')),
    JSON.stringify(destinationsMdp) + ' / appels auth=' + appelsAuth);
  check('E3 : aucun mot de passe écrit dans les journaux',
    !/console\.(log|error|warn)\([^)]*\b(mdp|password)\b/i.test(idx.replace(/autocomplete="new-password"/g, ''))
    && !/console\.(log|error|warn)\([^)]*\b(mdp|password)\b/i.test(dash));
  // « Un seul mécanisme » se mesure sur les APPELS, pas sur les
  // occurrences du mot (un libellé de log en contient aussi).
  const appelsReset = t => (t.match(/auth\.resetPasswordForEmail\(/g) || []).length;
  check('E4 : un seul point d\'appel de réinitialisation par page',
    appelsReset(dash) === 1 && appelsReset(idx) === 1,
    'dashboard=' + appelsReset(dash) + ' index=' + appelsReset(idx));
  check('E4b : les deux pages retombent sur la MÊME page d\'atterrissage',
    (dash.match(/\/dashboard\.html'/g) || []).length > 0
    && /_hcUrlRetourReinitialisation/.test(idx) && /urlRetourReinitialisation/.test(dash));
  // RÈGLE CORRIGÉE (lot A3). L'ancienne version exigeait que l'écran
  // « nouveau mot de passe » n'existe QUE dans dashboard.html. C'est
  // precisement ce qui cassait le parcours : quand l'URL de retour
  // n'est pas encore autorisee cote Supabase, le lien retombe sur la
  // « Site URL » du projet — la vitrine — et la personne n'avait alors
  // aucun ecran pour choisir son mot de passe.
  //
  // La regle devient donc plus stricte, jamais plus laxiste : l'ecran
  // doit exister DES DEUX COTES, en UN SEUL exemplaire par page, et
  // les deux doivent offrir les memes garanties.
  const nbFormulaires = t => (t.match(/id="reinit-mdp2"/g) || []).length;
  check('E4c : l\'écran « nouveau mot de passe » existe des deux côtés, en un seul exemplaire',
    nbFormulaires(idx) === 1 && nbFormulaires(dash) === 1,
    'index=' + nbFormulaires(idx) + ' dashboard=' + nbFormulaires(dash));
  check('E4d : les deux écrans exigent une vraie session avant d\'écrire',
    /auth\.updateUser\(\s*\{\s*password/.test(idx)
    && /auth\.updateUser\(\s*\{\s*password/.test(dash)
    && /getSession\(\)/.test(idx.slice(idx.indexOf('async function enregistrerNouveauMotDePasse'),
                                         idx.indexOf('async function enregistrerNouveauMotDePasse') + 2500)));
  check('E4e : les deux écrans reconnaissent le flux de récupération',
    /PASSWORD_RECOVERY/.test(idx) && /PASSWORD_RECOVERY/.test(dash));
  check('E4f : un lien expiré ou altéré est reconnu, jamais ignoré',
    /_hcErreurLienRecuperation/.test(idx) && /otp_expired|expired/i.test(idx));
  check('E4g : le jeton de récupération ne reste pas dans la barre d\'adresse',
    /_hcNettoyerFragmentRecuperation/.test(idx) && /replaceState/.test(idx));
  // Aucune redirection ouverte : l'URL de retour est CONSTRUITE a
  // partir de l'origine servie, jamais reprise d'un parametre.
  check('E4h : aucune redirection ouverte dans l\'URL de retour',
    !/redirectTo:\s*[^,)]*(searchParams|location\.search|document\.referrer)/.test(idx)
    && !/redirectTo:\s*[^,)]*(searchParams|location\.search|document\.referrer)/.test(dash));
  check('E5 : plus aucun prompt() pour choisir un mot de passe',
    !/prompt\([^)]*mot de passe[^)]*\)/i.test(dash) || !/prompt\([^)]*nouveau mot de passe/i.test(dash));
  check('E6 : aucune erreur JS', erreursJs.length === 0, erreursJs.join(' | '));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  await navigateur.close();
  process.exit(fail ? 1 : 0);
})();
