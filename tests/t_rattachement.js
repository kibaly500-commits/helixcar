// RATTACHEMENT DE LA DEMANDE À UN COMPTE (audit nº 5)
// ------------------------------------------------------------------
// Le navigateur posait payload.auth_user_id à partir de la réponse de
// signUp(). Mais la migration 92 IGNORE volontairement cette valeur et
// n'utilise que auth.uid() : sans cela, n'importe qui pourrait
// s'attribuer la demande d'un tiers.
//
// Conséquence : quand signUp() renvoie un utilisateur SANS session —
// le cas par défaut chez Supabase, dès que la confirmation d'e-mail est
// active — l'appel restait ANONYME. La demande était enregistrée sans
// propriétaire, pendant que l'écran annonçait un compte créé et un
// espace client où elle n'apparaîtrait jamais.
//
// Ce fichier éprouve les DEUX cas sur la vraie page, avec un double qui
// se comporte comme le serveur : il ne rattache que s'il y a une
// session au moment de l'appel.
const L = require('./lib.js');
const { RACINE, fichier, urlFichier } = L;
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 260) + ']' : '')); fail++; echecs.push(l); }
}

// `avecSession` décide du comportement de signUp :
//   true  -> confirmation d'e-mail DÉSACTIVÉE : session immédiate
//   false -> confirmation ACTIVE : un utilisateur, aucune session, et
//            signInWithPassword refuse tant que l'adresse n'est pas
//            confirmée.
function init(avecSession) {
  return `
window.__journal = [];
window.__session = null;
window.__avecSession = ${avecSession ? 'true' : 'false'};
window.__emails = [];
// L'e-mail de confirmation au client est un comportement PRODUIT. Il
// est intercepte ici : rien ne part reellement. Ce qui compte est son
// MOMENT — jamais avant que la demande soit ecrite.
window.emailjs = { init(){}, send(){ window.__journal.push({ op: 'email' }); return Promise.resolve(); },
                   sendForm(){ window.__journal.push({ op: 'email' }); return Promise.resolve(); } };

const UTILISATEUR = { id: '77777777-7777-7777-7777-777777777777', email: 'test-qa@example.invalid' };

window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange() { return { data: { subscription: { unsubscribe(){} } } }; },
    async getSession() { return { data: { session: window.__session } }; },
    async signUp(ident) {
      window.__journal.push({ op: 'signUp', email: ident && ident.email });
      if (window.__avecSession) {
        window.__session = { access_token: 'jwt-client', user: UTILISATEUR };
        return { data: { user: UTILISATEUR, session: window.__session }, error: null };
      }
      // Confirmation d'e-mail active : un utilisateur, PAS de session.
      return { data: { user: UTILISATEUR, session: null }, error: null };
    },
    async signInWithPassword(ident) {
      window.__journal.push({ op: 'signIn', email: ident && ident.email });
      if (window.__avecSession) {
        window.__session = { access_token: 'jwt-client', user: UTILISATEUR };
        return { data: { session: window.__session, user: UTILISATEUR }, error: null };
      }
      return { data: null, error: { message: 'Email not confirmed' } };
    },
    async signOut() { window.__session = null; return {}; }
  },
  from() { return { select(){return this;}, eq(){return this;}, order(){return this;},
                    limit(){return this;},
                    async insert(v){ window.__journal.push({ op:'insert', v }); return { error: null }; },
                    then(r){ return Promise.resolve({ data: [], error: null }).then(r); } }; },
  // LE DOUBLE SE COMPORTE COMME LE SERVEUR : il ne rattache que s'il y
  // a une session au moment de l'appel, exactement comme auth.uid().
  async rpc(nom, params) {
    window.__journal.push({ op: 'rpc', nom, params: JSON.parse(JSON.stringify(params || {})) });
    if (nom !== 'creer_demande_avec_vehicules') return { data: null, error: null };
    const rattachee = !!window.__session;
    return { data: {
      id: (params && params.p_demande && params.p_demande.id) || 'x',
      numero_client: (params && params.p_demande && params.p_demande.numero_client) || 'HC-QA',
      vehicules: 0, deja_existante: false,
      rattachee: rattachee
    }, error: null };
  },
  storage: { from(){ return { async createSignedUrl(){ return { data: null, error: null }; } }; } }
}; } };
`;
}

async function deposerCompteSeul(browser, avecSession) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(init(avecSession));
  await page.goto(urlFichier('index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(200);

  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'compte');
  await page.waitForTimeout(80);

  // On avance jusqu'au bout du parcours « compte seul ». Le mot de
  // passe vit sur une étape ultérieure : on le renseigne dès qu'il
  // apparaît, comme le ferait un client.
  for (let i = 0; i < 10; i++) {
    // La fin, c'est l'ECRITURE reellement partie — pas un balisage de
    // succes qui existe deja dans le document, masque.
    const fini = await page.evaluate(() =>
      window.__journal.some(j => j.op === 'rpc' && j.nom === 'creer_demande_avec_vehicules'));
    if (fini) break;
    await page.evaluate(() => {
      const mdp = document.getElementById('client-password');
      if (mdp && !mdp.value) {
        mdp.value = 'MotDePasseQA2026';
        mdp.dispatchEvent(new Event('input', { bubbles: true }));
        mdp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Le dernier écran n'avance plus : il se valide.
      const envoi = document.getElementById('client-submit-btn');
      if (envoi && envoi.offsetParent !== null && !envoi.disabled) { envoi.click(); return; }
      const b = document.getElementById('client-step-next-btn');
      if (b && !b.disabled) b.click();
    });
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1200);

  const etat = await page.evaluate(() => {
    const zone = document.getElementById('client-success-msg')
      || document.querySelector('#modal-client .hc-succes');
    const appels = window.__journal.filter(j => j.op === 'rpc'
      && j.nom === 'creer_demande_avec_vehicules');
    return {
      journal: window.__journal.map(j => j.op),
      appels: appels,
      succesTexte: zone ? zone.textContent : '',
      emails: window.__journal.filter(j => j.op === 'email').length,
      emailAvantEcriture: (function () {
        const iMail = window.__journal.findIndex(j => j.op === 'email');
        const iRpc = window.__journal.findIndex(j => j.op === 'rpc');
        return iMail !== -1 && (iRpc === -1 || iMail < iRpc);
      })()
    };
  });
  return { page, etat, erreurs };
}

(async () => {
  const browser = await L.lancerNavigateur();
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');

  // ══ A. LE NAVIGATEUR NE DÉCIDE PLUS DU PROPRIÉTAIRE ══
  check('A1 : le code n\'envoie plus d\'auth_user_id dans la demande',
    !/payload\.auth_user_id\s*=/.test(idx),
    (idx.match(/payload\.auth_user_id[^\n]*/g) || []).slice(0, 2).join(' | '));
  check('A2 : et il dit pourquoi — la fonction serveur l\'ignorerait',
    /ignore volontairement tout\s*\n?\s*\/\/ auth_user_id/.test(idx)
    || /n'utilise que auth\.uid\(\)/.test(idx));
  const mig = fs.readFileSync(fichier('migrations/92_creation_demande_atomique.sql'), 'utf8');
  check('A3 : c\'est le SERVEUR qui déclare si la demande est rattachée',
    /'rattachee', \(v_uid is not null\)/.test(mig));

  // ══ B. signUp DONNE UNE SESSION ══
  const b = await deposerCompteSeul(browser, true);
  check('B1 : un compte est bien créé', b.etat.journal.indexOf('signUp') !== -1,
    JSON.stringify(b.etat.journal));
  check('B2 : la demande est écrite', b.etat.appels.length === 1,
    JSON.stringify(b.etat.journal));
  check('B3 : et l\'appel ne prétend PAS désigner le propriétaire',
    b.etat.appels[0] && b.etat.appels[0].params.p_demande
      && b.etat.appels[0].params.p_demande.auth_user_id === undefined,
    JSON.stringify(b.etat.appels[0] && b.etat.appels[0].params.p_demande
      && b.etat.appels[0].params.p_demande.auth_user_id));
  check('B4 : le serveur la rattache, puisqu\'il y a une session',
    /visible dans votre espace client/i.test(b.etat.succesTexte),
    b.etat.succesTexte.slice(0, 200));
  check('B5 : aucune erreur JavaScript', b.erreurs.length === 0, b.erreurs.slice(0, 2).join(' | '));
  await b.page.close();

  // ══ C. signUp NE DONNE PAS DE SESSION (confirmation d'e-mail) ══
  const c = await deposerCompteSeul(browser, false);
  check('C1 : un compte est créé', c.etat.journal.indexOf('signUp') !== -1,
    JSON.stringify(c.etat.journal));
  check('C2 : une session est RÉELLEMENT tentée avant d\'écrire',
    c.etat.journal.indexOf('signIn') !== -1
      && c.etat.journal.indexOf('signIn') < c.etat.journal.lastIndexOf('rpc'),
    JSON.stringify(c.etat.journal));
  check('C3 : la demande est quand même enregistrée — elle n\'est jamais perdue',
    c.etat.appels.length === 1, JSON.stringify(c.etat.journal));
  check('C4 : elle part SANS propriétaire, et le navigateur n\'en invente pas',
    c.etat.appels[0] && c.etat.appels[0].params.p_demande
      && c.etat.appels[0].params.p_demande.auth_user_id === undefined,
    JSON.stringify(c.etat.appels[0] && c.etat.appels[0].params.p_demande
      && c.etat.appels[0].params.p_demande.auth_user_id));

  // LE POINT DE L'AUDIT : ne jamais annoncer un espace utilisable.
  check('C5 : l\'écran NE promet PAS un espace client utilisable',
    !/visible dans votre espace client/i.test(c.etat.succesTexte),
    c.etat.succesTexte.slice(0, 260));
  check('C6 : il demande la confirmation de l\'adresse e-mail',
    /Confirmez votre adresse e-mail/i.test(c.etat.succesTexte),
    c.etat.succesTexte.slice(0, 260));
  check('C7 : et il rassure sur le sort de la demande',
    /demande est bien enregistr/i.test(c.etat.succesTexte),
    c.etat.succesTexte.slice(0, 260));
  // L'e-mail de confirmation existait avant ce lot : ce qui doit etre
  // vrai, c'est qu'il ne parte JAMAIS avant que la demande soit ecrite.
  // Annoncer par e-mail une demande qui n'est pas enregistree serait le
  // meme defaut que l'annoncer a l'ecran.
  check('C8 : aucun e-mail n\'annonce la demande AVANT qu\'elle soit écrite',
    c.etat.emailAvantEcriture === false, JSON.stringify(c.etat.journal));
  check('C8b : et il est bien intercepté — rien ne part réellement',
    c.etat.emails >= 0 && c.erreurs.length === 0);
  check('C9 : aucune erreur JavaScript', c.erreurs.length === 0, c.erreurs.slice(0, 2).join(' | '));
  await c.page.close();

  // ══ D. LE MESSAGE VIENT DU SERVEUR, PAS D'UNE DEVINETTE ══
  check('D1 : l\'écran lit la réponse du serveur',
    /_retour\.rattachee === true/.test(idx));
  check('D2 : il ne se fie pas à la seule présence d\'un utilisateur',
    !/utilisateur && utilisateur\.id[\s\S]{0,80}espace client/i.test(idx));
  check('D3 : le titre n\'affirme plus un compte créé avant de le savoir',
    !/hc-succes-titre[^>]*>Votre compte est créé/.test(idx));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
