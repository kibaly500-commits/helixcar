// ══════════════════════════════════════════════════════════════════
// LOT A3 — MOT DE PASSE OUBLIÉ : LE LIEN DOIT MENER QUELQUE PART
// ══════════════════════════════════════════════════════════════════
// CE QUI ÉTAIT CONSTATÉ : on demande un lien, on reçoit un e-mail
// anglais « Reset your password », on clique sur « Reset password »…
// et on retombe sur la vitrine HelixCar, sans le moindre écran pour
// choisir un nouveau mot de passe.
//
// CAUSE : Supabase ne redirige vers `redirectTo` que si cette adresse
// figure dans ses « Redirect URLs ». Sinon il retombe silencieusement
// sur la « Site URL » du projet — la vitrine. Or l'écran de saisie
// n'existait QUE dans dashboard.html.
//
// Cette suite exécute le vrai code d'index.html contre un double
// Supabase : aucune connexion réseau, aucun e-mail réel, aucun compte
// réel. Les données sont préfixées TEST-QA.
const L = require('./lib.js');
const { fichier, urlFichier } = L;
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 260) + ']' : '')); fail++; echecs.push(l); }
}

// Double Supabase : session de récupération contrôlable, journal de
// tous les appels, et un « serveur » qui refuse ce qu'un vrai serveur
// refuserait.
const INIT = `
window.__journal = [];
window.__session = null;            // aucune session par défaut
window.__motDePasseCourant = 'AncienMdp-TEST-QA-1';
window.__refusUpdate = null;        // message d'erreur simulé
window.__ecouteurs = [];
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function (cb) {
      window.__ecouteurs.push(cb);
      return { data: { subscription: { unsubscribe: function () {} } } };
    },
    getSession: async function () { return { data: { session: window.__session } }; },
    updateUser: async function (attrs) {
      window.__journal.push({ op: 'updateUser', aUneSession: !!window.__session,
                              motDePasse: attrs && attrs.password });
      if (!window.__session) {
        return { data: null, error: { message: 'Auth session missing!' } };
      }
      if (window.__refusUpdate) {
        return { data: null, error: { message: window.__refusUpdate } };
      }
      window.__motDePasseCourant = attrs.password;
      return { data: { user: window.__session.user }, error: null };
    },
    signInWithPassword: async function (id) {
      window.__journal.push({ op: 'signIn', email: id && id.email });
      if (id && id.password === window.__motDePasseCourant) {
        return { data: { session: { user: { id: 'u-test-qa' } } }, error: null };
      }
      return { data: null, error: { message: 'Invalid login credentials' } };
    },
    resetPasswordForEmail: async function (email, opts) {
      window.__journal.push({ op: 'reset', email: email, redirectTo: opts && opts.redirectTo });
      return { error: null };
    },
    signOut: async function () { window.__journal.push({ op: 'signOut' }); window.__session = null; return {}; }
  },
  from: function () { return { select: function () { return { eq: function () { return { then: function (r) { return Promise.resolve({ data: [], error: null }).then(r); } }; } }; } }; },
  rpc: async function () { return { data: null, error: null }; },
  storage: { from: function () { return {}; } }
}; } };
window.emailjs = { init: function () {}, send: function () { return Promise.resolve(); } };
// Déclenche l'événement Supabase comme la vraie bibliothèque le ferait.
window.__emettre = function (evenement, session) {
  window.__session = session || window.__session;
  window.__ecouteurs.forEach(function (cb) { try { cb(evenement, window.__session); } catch (e) {} });
};
`;

async function pageVitrine(navigateur, fragment) {
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 2000 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push('PAGEERROR: ' + e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('index.html') + (fragment || ''), { waitUntil: 'load' });
  await page.waitForTimeout(220);
  page.jsErrors = erreurs;
  return page;
}

function etatEcran(page) {
  return page.evaluate(() => {
    const m = document.getElementById('modal-reinit');
    const vis = id => {
      const e = document.getElementById(id);
      return !!e && e.style.display !== 'none';
    };
    return {
      modaleOuverte: !!m && m.classList.contains('open'),
      formulaire: vis('reinit-bloc-formulaire'),
      succes: vis('reinit-bloc-succes'),
      expire: vis('reinit-bloc-expire'),
      message: ((document.getElementById('reinit-message') || {}).textContent || '').trim(),
      messageVisible: !!(document.getElementById('reinit-message') || {}).classList
        && document.getElementById('reinit-message').classList.contains('visible')
    };
  });
}

(async () => {
  const navigateur = await L.lancerNavigateur();
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');

  // ══ A. L'ÉCRAN EXISTE LÀ OÙ LE LIEN ATTERRIT ══
  {
    const page = await pageVitrine(navigateur);
    let e = await etatEcran(page);
    check('A1 : au chargement normal, aucun écran de mot de passe ne s\'ouvre',
      e.modaleOuverte === false, JSON.stringify(e));

    // Supabase établit la session de récupération et émet l'événement.
    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY',
      { access_token: 'jwt-recup', user: { id: 'u-test-qa', email: 'test-qa-claude-pr4@example.invalid' } }));
    await page.waitForTimeout(150);
    e = await etatEcran(page);
    check('A2 : REPRODUCTION — le flux de récupération ouvre bien un écran dédié',
      e.modaleOuverte === true && e.formulaire === true, JSON.stringify(e));
    check('A3 : ni succès ni « lien expiré » avant toute saisie',
      e.succes === false && e.expire === false, JSON.stringify(e));

    const champs = await page.evaluate(() => ({
      mdp: !!document.getElementById('reinit-mdp'),
      mdp2: !!document.getElementById('reinit-mdp2'),
      oeils: document.querySelectorAll('#modal-reinit .btn-oeil').length,
      typeMdp: (document.getElementById('reinit-mdp') || {}).type,
      typeMdp2: (document.getElementById('reinit-mdp2') || {}).type,
      autocomplete: (document.getElementById('reinit-mdp') || {}).autocomplete
    }));
    check('A4 : les deux champs demandés sont là, masqués, avec leurs boutons œil',
      champs.mdp && champs.mdp2 && champs.oeils === 2
      && champs.typeMdp === 'password' && champs.typeMdp2 === 'password',
      JSON.stringify(champs));
    check('A5 : et ils sont déclarés comme nouveaux mots de passe',
      champs.autocomplete === 'new-password', champs.autocomplete);
    await page.close();
  }

  // ══ B. LES RÈGLES DE SÉCURITÉ SONT APPLIQUÉES ══
  {
    const page = await pageVitrine(navigateur);
    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY',
      { access_token: 'jwt-recup', user: { id: 'u-test-qa' } }));
    await page.waitForTimeout(120);

    // Trop court.
    await page.evaluate(() => {
      document.getElementById('reinit-mdp').value = 'court';
      document.getElementById('reinit-mdp2').value = 'court';
    });
    await page.evaluate(() => enregistrerNouveauMotDePasse());
    await page.waitForTimeout(120);
    let e = await etatEcran(page);
    let j = await page.evaluate(() => window.__journal.filter(x => x.op === 'updateUser'));
    check('B1 : un mot de passe trop court est refusé, sans appel serveur',
      /8 caract/.test(e.message) && j.length === 0, JSON.stringify(e) + ' / ' + JSON.stringify(j));

    // Confirmation différente.
    await page.evaluate(() => {
      document.getElementById('reinit-mdp').value = 'MotDePasse-TEST-QA-1';
      document.getElementById('reinit-mdp2').value = 'MotDePasse-TEST-QA-2';
    });
    await page.evaluate(() => enregistrerNouveauMotDePasse());
    await page.waitForTimeout(120);
    e = await etatEcran(page);
    j = await page.evaluate(() => window.__journal.filter(x => x.op === 'updateUser'));
    check('B2 : deux mots de passe différents sont refusés, sans appel serveur',
      /identiques/i.test(e.message) && j.length === 0, JSON.stringify(e));
    check('B3 : et l\'écran de succès ne s\'affiche jamais dans ces cas',
      e.succes === false, JSON.stringify(e));
    await page.close();
  }

  // ══ C. LE MOT DE PASSE CHANGE VRAIMENT, ET SEULEMENT ALORS ══
  {
    const page = await pageVitrine(navigateur);
    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY',
      { access_token: 'jwt-recup', user: { id: 'u-test-qa' } }));
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      document.getElementById('reinit-mdp').value = 'NouveauMdp-TEST-QA-9';
      document.getElementById('reinit-mdp2').value = 'NouveauMdp-TEST-QA-9';
    });
    await page.evaluate(() => enregistrerNouveauMotDePasse());
    await page.waitForTimeout(200);
    const e = await etatEcran(page);
    const j = await page.evaluate(() => window.__journal.filter(x => x.op === 'updateUser'));
    check('C1 : le serveur est appelé une seule fois, avec une session',
      j.length === 1 && j[0].aUneSession === true, JSON.stringify(j));
    check('C2 : le succès n\'est annoncé qu\'APRÈS la réponse du serveur',
      e.succes === true && e.formulaire === false, JSON.stringify(e));

    // Le nouveau mot de passe fonctionne, l'ancien non.
    const essais = await page.evaluate(async () => {
      const ancien = await window.supabase.createClient().auth
        .signInWithPassword({ email: 'x@example.invalid', password: 'AncienMdp-TEST-QA-1' });
      const nouveau = await window.supabase.createClient().auth
        .signInWithPassword({ email: 'x@example.invalid', password: 'NouveauMdp-TEST-QA-9' });
      return { ancien: !ancien.error, nouveau: !nouveau.error };
    });
    check('C3 : le nouveau mot de passe fonctionne',  essais.nouveau === true, JSON.stringify(essais));
    check('C4 : et l\'ancien ne fonctionne plus',     essais.ancien === false, JSON.stringify(essais));

    const url = await page.evaluate(() => window.location.hash);
    check('C5 : le jeton ne reste pas dans la barre d\'adresse', url === '', url);
    await page.close();
  }

  // ══ D. SANS SESSION DE RÉCUPÉRATION, RIEN N'EST MODIFIÉ ══
  {
    const page = await pageVitrine(navigateur);
    await page.evaluate(() => { ouvrirEcranNouveauMotDePasse('formulaire'); });
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      document.getElementById('reinit-mdp').value = 'Pirate-TEST-QA-1';
      document.getElementById('reinit-mdp2').value = 'Pirate-TEST-QA-1';
    });
    await page.evaluate(() => enregistrerNouveauMotDePasse());
    await page.waitForTimeout(200);
    const e = await etatEcran(page);
    const mdp = await page.evaluate(() => window.__motDePasseCourant);
    const j = await page.evaluate(() => window.__journal.filter(x => x.op === 'updateUser'));
    check('D1 : sans session de récupération, aucun mot de passe n\'est écrit',
      mdp === 'AncienMdp-TEST-QA-1' && j.length === 0, mdp + ' / ' + JSON.stringify(j));
    check('D2 : et l\'écran le dit — « lien expiré », jamais un faux succès',
      e.expire === true && e.succes === false, JSON.stringify(e));
    await page.close();
  }

  // ══ E. LIEN EXPIRÉ, ALTÉRÉ, OU DÉJÀ UTILISÉ ══
  {
    // Supabase renvoie l'erreur dans le fragment d'URL.
    const page = await pageVitrine(navigateur,
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    const e = await etatEcran(page);
    check('E1 : un lien expiré ouvre l\'écran « lien expiré », jamais la vitrine muette',
      e.modaleOuverte === true && e.expire === true, JSON.stringify(e));
    check('E2 : et il propose d\'en demander un nouveau',
      /nouveau/i.test(await page.evaluate(() =>
        (document.querySelector('#reinit-bloc-expire button') || {}).textContent || '')));
    await page.close();

    // Lien déjà utilisé : la session n'existe plus quand on enregistre.
    const page2 = await pageVitrine(navigateur);
    await page2.evaluate(() => window.__emettre('PASSWORD_RECOVERY',
      { access_token: 'jwt-recup', user: { id: 'u-test-qa' } }));
    await page2.waitForTimeout(120);
    await page2.evaluate(() => { window.__session = null; });   // le lien a servi entre-temps
    await page2.evaluate(() => {
      document.getElementById('reinit-mdp').value = 'NouveauMdp-TEST-QA-9';
      document.getElementById('reinit-mdp2').value = 'NouveauMdp-TEST-QA-9';
    });
    await page2.evaluate(() => enregistrerNouveauMotDePasse());
    await page2.waitForTimeout(200);
    const e2 = await etatEcran(page2);
    check('E3 : un lien déjà utilisé ne produit jamais un faux succès',
      e2.expire === true && e2.succes === false, JSON.stringify(e2));
    await page2.close();
  }

  // ══ F. REPRISE APRÈS RECHARGEMENT ══
  {
    const page = await pageVitrine(navigateur);
    await page.evaluate(() => window.__emettre('PASSWORD_RECOVERY',
      { access_token: 'jwt-recup', user: { id: 'u-test-qa' } }));
    await page.waitForTimeout(120);
    const memorise = await page.evaluate(() => sessionStorage.getItem('helixcar_reinit_en_cours'));
    check('F1 : la réinitialisation en cours est mémorisée pour survivre à un F5',
      memorise === '1', String(memorise));

    // Rechargement : Supabase ne rejoue pas PASSWORD_RECOVERY, mais la
    // session de récupération est toujours là.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__emettre('INITIAL_SESSION',
      { access_token: 'jwt-recup', user: { id: 'u-test-qa' } }));
    await page.waitForTimeout(150);
    const e = await etatEcran(page);
    check('F2 : après rechargement, l\'écran revient au lieu de disparaître',
      e.modaleOuverte === true && e.formulaire === true, JSON.stringify(e));
    await page.close();
  }

  // ══ G. AUCUNE REDIRECTION OUVERTE, AUCUNE ÉNUMÉRATION ══
  {
    const page = await pageVitrine(navigateur);
    const r = await page.evaluate(async () => {
      document.getElementById('connexion-email').value = 'test-qa-claude-pr4@example.invalid';
      await demanderReinitialisationMotDePasse();
      return {
        journal: window.__journal.filter(x => x.op === 'reset'),
        message: (document.getElementById('connexion-message') || {}).textContent || ''
      };
    });
    check('G1 : l\'URL de retour reste sur notre propre origine',
      r.journal.length === 1 && /^file:|^https?:\/\/(localhost|127\.0\.0\.1|helixcar\.vercel\.app)/.test(
        String(r.journal[0].redirectTo).replace(/\/dashboard\.html$/, '')),
      JSON.stringify(r.journal));
    check('G2 : le message reste neutre — il ne dit jamais si l\'adresse existe',
      /Si un compte correspond/.test(r.message), r.message);

    // Une adresse inconnue produit EXACTEMENT le même message.
    const r2 = await page.evaluate(async () => {
      document.getElementById('connexion-email').value = 'inconnu-test-qa@example.invalid';
      await demanderReinitialisationMotDePasse();
      return (document.getElementById('connexion-message') || {}).textContent || '';
    });
    check('G3 : et il est identique pour une adresse inconnue', r2 === r.message, r2);
    check('G4 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
    await page.close();
  }

  // ══ H. LES MODÈLES D'E-MAIL SONT VERSIONNÉS, EN FRANÇAIS ══
  {
    const chemin = fichier('supabase/templates');
    const existe = fs.existsSync(chemin);
    check('H1 : les modèles d\'e-mail Supabase sont versionnés dans le dépôt', existe);
    if (existe) {
      // Ce qui compte est le contenu REELLEMENT lu par le destinataire :
      // les commentaires HTML, qui indiquent a l'administrateur ou coller
      // le modele, ne s'affichent pas et peuvent nommer le modele
      // Supabase d'origine.
      const sansCommentaires = t => t.replace(/<!--[\s\S]*?-->/g, '');
      const recup = sansCommentaires(
        fs.readFileSync(fichier('supabase/templates/recuperation-mot-de-passe.html'), 'utf8'));
      // L'OBJET se saisit dans le champ « Subject » de Supabase : il est
      // donc consigne dans l'en-tete du fichier, pour etre recopie tel
      // quel. Le BOUTON, lui, doit vraiment etre dans le corps.
      const recupBrut = fs.readFileSync(fichier('supabase/templates/recuperation-mot-de-passe.html'), 'utf8');
      check('H2 : l\'objet demandé est consigné, et le bouton est bien dans le corps',
        /Réinitialisez votre mot de passe HelixCar/.test(recupBrut)
        && /Choisir un nouveau mot de passe/.test(recup),
        'objet=' + /Réinitialisez votre mot de passe HelixCar/.test(recupBrut)
        + ' bouton=' + /Choisir un nouveau mot de passe/.test(recup));
      check('H3 : le modèle utilise bien le jeton Supabase, jamais une URL figée',
        /\{\{\s*\.ConfirmationURL\s*\}\}/.test(recup));
      check('H4 : plus aucun texte anglais du modèle par défaut',
        !/Reset your password|Follow this link/i.test(recup));
      const conf = sansCommentaires(
        fs.readFileSync(fichier('supabase/templates/confirmation-adresse.html'), 'utf8'));
      check('H5 : le modèle de confirmation d\'adresse est lui aussi en français',
        /Confirmez votre adresse e-mail/.test(conf)
        && !/Confirm your email address|Follow this link/i.test(conf));
    }
  }

  // ══ I. LES DEUX PAGES PARTAGENT LES MÊMES GARANTIES ══
  check('I1 : les deux pages reconnaissent PASSWORD_RECOVERY',
    /PASSWORD_RECOVERY/.test(idx) && /PASSWORD_RECOVERY/.test(dash));
  check('I2 : les deux pages écrivent par auth.updateUser, jamais autrement',
    /auth\.updateUser\(/.test(idx) && /auth\.updateUser\(/.test(dash));
  check('I3 : aucune des deux ne code en dur le déploiement d\'aperçu',
    !/helixcar-i89b/.test(idx) && !/helixcar-i89b/.test(dash));

  await navigateur.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
