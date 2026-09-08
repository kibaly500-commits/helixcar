// LONGUEUR MINIMALE UNIFIÉE ET BOUTON ŒIL
// Exécute le vrai code des trois pages portant un champ de mot de passe.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}
const RACINE = '/home/user/helixcar';

const INIT = `
window.__journal = [];
window.__emails = [];
window.__comptes = { 'connu@helixcar.test': 'ancienMdp' };  // 9 caractères
window.__session = null;
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function (cb) { window.__declencher = cb; return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function (id) {
      window.__journal.push({ op: 'signIn', email: id && id.email, longueur: (id && id.password || '').length });
      const attendu = window.__comptes[id.email];
      if (attendu && attendu === id.password) {
        window.__session = { access_token: 'j', user: { id: 'u-1', email: id.email } };
        return { data: { session: window.__session, user: window.__session.user }, error: null };
      }
      return { data: null, error: { message: 'Invalid login credentials' } };
    },
    signUp: async function (id) {
      window.__journal.push({ op: 'signUp', longueur: (id && id.password || '').length });
      return { data: { user: { id: 'u-2' } }, error: null };
    },
    updateUser: async function (a) {
      window.__journal.push({ op: 'updateUser', longueur: (a && a.password || '').length });
      return { data: {}, error: null };
    },
    resetPasswordForEmail: async function () { window.__journal.push({ op: 'reset' }); return { data: {}, error: null }; },
    signOut: async function () { window.__session = null; return {}; }
  },
  from: function () { return { select(){return this;}, eq(){return this;}, order(){return this;}, limit(){return this;},
    then(r){ return Promise.resolve({ data: [], error: null }).then(r); } }; },
  rpc: async function () { return { data: [], error: null }; },
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: null }; } }; } }
}; } };
window.emailjs = { init: function () {},
  send: function () { window.__emails.push(1); return Promise.resolve(); },
  sendForm: function () { window.__emails.push(1); return Promise.resolve(); } };
`;

// Vérifie le contrat complet d'un bouton œil sur un champ donné.
async function verifierOeil(page, prefixe, idChamp, idBouton) {
  const r = await page.evaluate(([champId, boutonSel]) => {
    const champ = document.getElementById(champId);
    const bouton = document.querySelector(boutonSel);
    if (!champ || !bouton) return { erreur: 'introuvable' };
    champ.value = 'MonMotDePasse1';
    champ.focus();
    try { champ.setSelectionRange(3, 3); } catch (e) {}

    const initial = {
      type: champ.type,
      aria: bouton.getAttribute('aria-pressed'),
      libelle: bouton.getAttribute('aria-label'),
      typeBouton: bouton.getAttribute('type')
    };
    bouton.click();
    const apres1 = {
      type: champ.type, valeur: champ.value,
      aria: bouton.getAttribute('aria-pressed'),
      libelle: bouton.getAttribute('aria-label'),
      titre: bouton.getAttribute('title'),
      focus: document.activeElement === champ,
      curseur: (function () { try { return champ.selectionStart; } catch (e) { return null; } })()
    };
    bouton.click();
    const apres2 = { type: champ.type, valeur: champ.value, aria: bouton.getAttribute('aria-pressed') };

    // Taille tactile réelle
    const boite = bouton.getBoundingClientRect();
    // Le texte ne doit pas passer sous l'icône : réserve à droite du champ
    const reserve = parseFloat(getComputedStyle(champ).paddingRight) || 0;

    return { initial, apres1, apres2, largeur: boite.width, hauteur: boite.height, reserve };
  }, [idChamp, idBouton]);

  if (r.erreur) { check(prefixe + ' : champ et bouton présents', false, r.erreur); return; }
  check(prefixe + ' : masqué par défaut',
    r.initial.type === 'password' && r.initial.aria === 'false', JSON.stringify(r.initial));
  check(prefixe + ' : le bouton ne soumet pas le formulaire', r.initial.typeBouton === 'button');
  check(prefixe + ' : premier clic -> affiché',
    r.apres1.type === 'text' && r.apres1.aria === 'true', JSON.stringify(r.apres1));
  check(prefixe + ' : libellé accessible mis à jour',
    /Masquer le mot de passe/.test(r.apres1.libelle) && /Masquer le mot de passe/.test(r.apres1.titre || ''),
    r.apres1.libelle + ' / ' + r.apres1.titre);
  check(prefixe + ' : valeur inchangée par la bascule', r.apres1.valeur === 'MonMotDePasse1', r.apres1.valeur);
  check(prefixe + ' : focus et curseur conservés',
    r.apres1.focus === true && r.apres1.curseur === 3, JSON.stringify(r.apres1));
  check(prefixe + ' : second clic -> masqué de nouveau',
    r.apres2.type === 'password' && r.apres2.aria === 'false' && r.apres2.valeur === 'MonMotDePasse1',
    JSON.stringify(r.apres2));
  check(prefixe + ' : cible tactile suffisante (>= 32 px)',
    r.largeur >= 32 && r.hauteur >= 32, r.largeur + 'x' + r.hauteur);
  check(prefixe + ' : le texte ne passe pas sous l\'icône',
    r.reserve >= 34, 'padding-right=' + r.reserve);
}

(async () => {
  const navigateur = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1000 } });
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);

  // ══ A. LONGUEUR — INSCRIPTION CLIENT ══
  await page.goto('file://' + path.resolve(RACINE, 'index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.evaluate(() => { try { openModal('client'); } catch (e) {} });
  await page.waitForTimeout(150);

  const longueurs = await page.evaluate(() => {
    const essai = v => {
      document.getElementById('client-password').value = v;
      const ok = _checkPassword('client-password', true);
      const err = (document.getElementById('client-password-err') || {}).textContent || '';
      return { ok: ok, err: err };
    };
    return { six: essai('123456'), sept: essai('1234567'), huit: essai('12345678') };
  });
  check('A1 : 6 caractères REFUSÉS à l\'inscription client', longueurs.six.ok === false);
  check('A2 : 7 caractères REFUSÉS à l\'inscription client', longueurs.sept.ok === false);
  check('A3 : 8 caractères acceptés à l\'inscription client', longueurs.huit.ok === true);
  check('A4 : le message annonce bien 8 caractères',
    /au moins 8 caractères/.test(longueurs.six.err), longueurs.six.err);

  const attributs = await page.evaluate(() => ({
    minlength: (document.getElementById('client-password') || {}).getAttribute('minlength'),
    aide: (document.getElementById('client-password-aide') || {}).textContent || ''
  }));
  check('A5 : attribut minlength harmonisé', attributs.minlength === '8', String(attributs.minlength));
  check('A6 : texte d\'aide cohérent', /8 caractères/.test(attributs.aide), attributs.aide);
  const positionAide = await page.evaluate(() => {
    const champ = document.getElementById('client-password');
    const aide = document.getElementById('client-password-aide');
    const label = champ.closest('.modal-form-group').querySelector('label');
    if (!champ || !aide || !label) return null;
    const c = champ.getBoundingClientRect(), a = aide.getBoundingClientRect(), l = label.getBoundingClientRect();
    return { aideSousChamp: a.top >= c.bottom - 1, aideApresLabel: a.top > l.top,
             champJusteSousLabel: c.top < a.top };
  });
  check('A6b : l\'aide est SOUS l\'encadré, pas entre le libellé et le champ',
    positionAide && positionAide.aideSousChamp === true && positionAide.champJusteSousLabel === true,
    JSON.stringify(positionAide));

  // ══ B. LA CONNEXION NE JUGE PAS LA LONGUEUR ══
  const connexionCourte = await page.evaluate(async () => {
    window.__journal = [];
    closeModal('client');
    openModal('connexion');
    document.getElementById('connexion-email').value = 'connu@helixcar.test';
    document.getElementById('connexion-password').value = 'court1';   // 6 caractères
    await submitConnexionForm();
    return {
      transmis: window.__journal.filter(j => j.op === 'signIn'),
      message: (document.getElementById('connexion-message') || {}).textContent || ''
    };
  });
  check('B1 : un mot de passe historique court est TRANSMIS à Supabase',
    connexionCourte.transmis.length === 1 && connexionCourte.transmis[0].longueur === 6,
    JSON.stringify(connexionCourte.transmis));
  check('B2 : aucune règle locale de longueur n\'est appliquée à la connexion',
    !/8 caractères/.test(connexionCourte.message), connexionCourte.message);

  const connexionOk = await page.evaluate(async () => {
    window.__journal = [];
    document.getElementById('connexion-password').value = 'ancienMdp';   // 9, correct
    await submitConnexionForm();
    return window.__journal.filter(j => j.op === 'signIn').length;
  });
  check('B3 : un compte existant se connecte normalement', connexionOk === 1);

  // Une connexion réussie redirige vers l'espace : on revient sur le
  // site public pour la suite.
  await page.waitForTimeout(400);
  await page.goto('file://' + path.resolve(RACINE, 'index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.evaluate(() => { try { openModal('client'); closeModal('client'); openModal('connexion'); closeModal('connexion'); } catch (e) {} });

  // ══ C. ŒIL — SITE PUBLIC ══
  await page.evaluate(() => openModal('client'));
  await page.waitForTimeout(120);
  await verifierOeil(page, 'C-inscription client', 'client-password',
    '#modal-client .btn-oeil');
  await page.evaluate(() => { closeModal('client'); openModal('connexion'); });
  await page.waitForTimeout(120);
  await verifierOeil(page, 'C-connexion client', 'connexion-password',
    '#modal-connexion .btn-oeil');

  const independance = await page.evaluate(() => {
    openModal('client');
    const a = document.getElementById('client-password');
    a.value = 'AAA';
    document.querySelector('#modal-client .btn-oeil').click();
    const b = document.getElementById('connexion-password');
    return { client: a.type, connexion: b.type };
  });
  check('C1 : chaque œil ne contrôle QUE son champ',
    independance.client === 'text' && independance.connexion === 'password', JSON.stringify(independance));

  const reouverture = await page.evaluate(() => {
    closeModal('client');
    openModal('client');
    const a = document.getElementById('client-password');
    const b = document.querySelector('#modal-client .btn-oeil');
    return { type: a.type, aria: b.getAttribute('aria-pressed'), libelle: b.getAttribute('aria-label') };
  });
  check('C2 : après fermeture puis réouverture, retour à l\'état masqué',
    reouverture.type === 'password' && reouverture.aria === 'false'
    && /Afficher le mot de passe/.test(reouverture.libelle), JSON.stringify(reouverture));

  // Clavier
  const clavier = await page.evaluate(async () => {
    const b = document.querySelector('#modal-client .btn-oeil');
    b.focus();
    const avant = document.getElementById('client-password').type;
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    b.click();   // ce que le navigateur fait nativement sur Entrée/Espace
    return { avant, apres: document.getElementById('client-password').type,
             focusable: b.tabIndex >= 0 || b.tagName === 'BUTTON' };
  });
  check('C3 : le bouton est atteignable et actionnable au clavier',
    clavier.focusable === true && clavier.avant !== clavier.apres, JSON.stringify(clavier));

  // Tactile
  const tactile = await page.evaluate(() => {
    const b = document.querySelector('#modal-client .btn-oeil');
    const champ = document.getElementById('client-password');
    const avant = champ.type;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    b.click();
    return { avant, apres: champ.type };
  });
  check('C4 : fonctionnement au toucher', tactile.avant !== tactile.apres, JSON.stringify(tactile));

  // Petit écran
  await page.setViewportSize({ width: 360, height: 720 });
  await page.waitForTimeout(150);
  const mobile = await page.evaluate(() => {
    const champ = document.getElementById('client-password');
    const bouton = document.querySelector('#modal-client .btn-oeil');
    const c = champ.getBoundingClientRect(), b = bouton.getBoundingClientRect();
    return {
      boutonDansChamp: b.right <= c.right + 1 && b.left >= c.left,
      reserve: parseFloat(getComputedStyle(champ).paddingRight) || 0,
      largeurBouton: b.width,
      debordement: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  check('C5 : sur petit écran, l\'œil reste dans le champ',
    mobile.boutonDansChamp === true, JSON.stringify(mobile));
  check('C6 : aucun chevauchement texte / icône sur petit écran',
    mobile.reserve >= mobile.largeurBouton - 6, JSON.stringify(mobile));
  check('C7 : aucun débordement horizontal', mobile.debordement === false);
  await page.setViewportSize({ width: 1280, height: 1000 });

  // ══ D. DASHBOARD : CONNEXION ET RÉINITIALISATION ══
  await page.goto('file://' + path.resolve(RACINE, 'dashboard.html'), { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await verifierOeil(page, 'D-connexion dashboard', 'login-pw', '#login-screen .btn-oeil');

  await page.evaluate(() => {
    window.__session = { access_token: 'j', user: { id: 'u-1', email: 'connu@helixcar.test' } };
    window.__declencher('PASSWORD_RECOVERY', window.__session);
  });
  await page.waitForTimeout(200);
  await verifierOeil(page, 'D-nouveau mot de passe', 'reinit-mdp',
    '#modal-reinit-mdp .btn-oeil');
  await verifierOeil(page, 'D-confirmation', 'reinit-mdp2',
    '#modal-reinit-mdp .btn-oeil[onclick*="reinit-mdp2"]');

  const independance2 = await page.evaluate(() => {
    const a = document.getElementById('reinit-mdp');
    const b = document.getElementById('reinit-mdp2');
    a.type = 'password'; b.type = 'password';
    document.querySelectorAll('#modal-reinit-mdp .btn-oeil')[0].click();
    return { premier: a.type, second: b.type };
  });
  check('D1 : les deux yeux de la réinitialisation sont indépendants',
    independance2.premier === 'text' && independance2.second === 'password', JSON.stringify(independance2));

  const longueursReinit = await page.evaluate(async () => {
    const essai = async (v1, v2) => {
      window.__journal = [];
      document.getElementById('reinit-mdp').value = v1;
      document.getElementById('reinit-mdp2').value = v2;
      await enregistrerNouveauMotDePasse();
      return {
        appels: window.__journal.filter(j => j.op === 'updateUser').length,
        alerte: (document.getElementById('reinit-alert') || {}).textContent || ''
      };
    };
    return {
      six: await essai('123456', '123456'),
      sept: await essai('1234567', '1234567'),
      differents: await essai('MotDePasse1', 'MotDePasse2'),
      huit: await essai('12345678', '12345678')
    };
  });
  check('D2 : 6 caractères REFUSÉS au nouveau mot de passe', longueursReinit.six.appels === 0);
  check('D3 : 7 caractères REFUSÉS au nouveau mot de passe', longueursReinit.sept.appels === 0);
  check('D4 : deux mots de passe différents REFUSÉS',
    longueursReinit.differents.appels === 0 && /ne sont pas identiques/.test(longueursReinit.differents.alerte));
  check('D5 : 8 caractères acceptés à la réinitialisation', longueursReinit.huit.appels === 1);
  check('D6 : le message annonce bien 8 caractères',
    /au moins 8 caractères/.test(longueursReinit.six.alerte), longueursReinit.six.alerte);

  const reouverture2 = await page.evaluate(() => {
    document.getElementById('reinit-mdp').type = 'text';
    closeModal('reinit-mdp');
    ouvrirFormulaireNouveauMotDePasse();
    return document.getElementById('reinit-mdp').type;
  });
  check('D7 : rouvrir le formulaire remet les champs masqués', reouverture2 === 'password', reouverture2);

  const attributsReinit = await page.evaluate(() => ({
    a: (document.getElementById('reinit-mdp') || {}).getAttribute('minlength'),
    b: (document.getElementById('reinit-mdp2') || {}).getAttribute('minlength')
  }));
  check('D8 : minlength harmonisé sur les deux champs',
    attributsReinit.a === '8' && attributsReinit.b === '8', JSON.stringify(attributsReinit));

  // ══ E. INSCRIPTION PARTENAIRE ══
  await page.goto('file://' + path.resolve(RACINE, 'creer-compte-convoyeur.html'), { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await verifierOeil(page, 'E-inscription partenaire', 'cc-pw', '.pw-toggle');

  const partenaire = await page.evaluate(() => {
    const champs = ['cc-pw', 'cc-pw2'].map(i => document.getElementById(i));
    return {
      minlength: champs.map(c => c && c.getAttribute('minlength')),
      yeux: document.querySelectorAll('.pw-toggle').length,
      svg: document.querySelectorAll('.pw-toggle svg').length
    };
  });
  check('E1 : minlength harmonisé côté partenaire',
    partenaire.minlength.every(v => v === '8'), JSON.stringify(partenaire.minlength));
  check('E2 : un œil par champ', partenaire.yeux === 2);
  check('E3 : icône cohérente avec le reste du projet (SVG, pas emoji)', partenaire.svg === 2);

  // ══ F. GARDE-FOUS ══
  check('F1 : aucun e-mail EmailJS déclenché',
    await page.evaluate(() => window.__emails.length) === 0);
  check('F2 : aucune erreur JS', erreursJs.length === 0, erreursJs.join(' | '));

  const idx = fs.readFileSync(path.resolve(RACINE, 'index.html'), 'utf8');
  const dash = fs.readFileSync(path.resolve(RACINE, 'dashboard.html'), 'utf8');
  const conv = fs.readFileSync(path.resolve(RACINE, 'creer-compte-convoyeur.html'), 'utf8');
  const toutes = idx + dash + conv;

  // On extrait le CORPS de la fonction par équilibrage d'accolades :
  // une simple fenêtre de caractères déborderait sur le code voisin et
  // ne prouverait rien.
  function corpsDe(source, nom) {
    const i = source.indexOf('function ' + nom + '(');
    if (i === -1) return '';
    const debut = source.indexOf('{', i);
    let profondeur = 0;
    for (let k = debut; k < source.length; k++) {
      if (source[k] === '{') profondeur++;
      else if (source[k] === '}') { profondeur--; if (profondeur === 0) return source.slice(debut, k + 1); }
    }
    return '';
  }
  const corps = [idx, dash, conv].map(f => corpsDe(f, 'basculerMotDePasse'));
  check('F3 : la bascule ne fait QUE changer le type du champ',
    corps.every(c => c.length > 0
      && !/localStorage|sessionStorage|fetch\(|emailjs|console\./.test(c)
      && /\.type =/.test(c)),
    corps.map(c => c.length).join(','));
  check('F4 : aucun mot de passe stocké hors de Supabase Auth',
    !/(localStorage|sessionStorage)\.setItem\([^)]*(mdp|password|motDePasse)/i.test(toutes));
  check('F5 : plus aucune règle à 6 caractères dans le produit',
    !/au moins 6 caractères/.test(toutes));
  check('F6 : une seule valeur de longueur minimale, déclarée',
    /HC_MDP_LONGUEUR_MIN = 8/.test(idx) && /REINIT_LONGUEUR_MIN = 8/.test(dash));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  await navigateur.close();
  process.exit(fail ? 1 : 0);
})();
