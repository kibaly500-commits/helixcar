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

  // ══ C bis. LE PARCOURS COMPLET : CONFIRMATION PUIS SESSION ══
  //
  // C'est le point que le test precedent ne verifiait PAS. Il lisait le
  // message affiche, et s'arretait la. La phrase « elle apparaitra dans
  // votre espace une fois votre adresse confirmee » n'etait donc jamais
  // eprouvee — et elle etait fausse.
  //
  // Ici, on va jusqu'au bout : le client confirme, ouvre une session, et
  // on regarde ce que le serveur fait REELLEMENT de sa demande.
  const enAttente = await c.page.evaluate(() => {
    let liste = [];
    try { liste = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    return liste;
  });
  check('C10 : de quoi réclamer la demande est conservé',
    enAttente.length === 1 && !!enAttente[0].id && !!enAttente[0].cle,
    JSON.stringify(enAttente));
  check('C11 : et rien de plus que le strict nécessaire',
    enAttente[0] && Object.keys(enAttente[0]).sort().join(',') === 'cle,email,expire,id',
    JSON.stringify(enAttente[0] && Object.keys(enAttente[0])));
  check('C12 : avec une date d\'expiration',
    enAttente[0] && enAttente[0].expire > Date.now(), String(enAttente[0] && enAttente[0].expire));
  check('C13 : le secret conservé est celui envoyé à la création',
    enAttente[0] && c.etat.appels[0]
      && enAttente[0].cle === c.etat.appels[0].params.p_cle_creation,
    'mémorisé ≠ envoyé');
  check('C14 : et l\'identifiant est celui de la demande écrite',
    enAttente[0] && c.etat.appels[0]
      && enAttente[0].id === c.etat.appels[0].params.p_demande.id);

  // Le client confirme son adresse, puis revient. Un double serveur qui
  // se comporte comme la migration 99 : il n'accepte que sur preuve.
  const apresConfirmation = await c.page.evaluate(async () => {
    const journal = [];
    const DEMANDE = { id: null, email: 'test-qa@example.invalid', proprietaire: null,
                      hash: null };
    let liste = [];
    try { liste = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    DEMANDE.id = liste[0] && liste[0].id;
    DEMANDE.hash = liste[0] && liste[0].cle;   // le double compare en clair

    // Session ouverte, adresse CONFIRMÉE.
    const client = {
      rpc: async function (nom, params) {
        journal.push({ nom, params });
        if (nom !== 'reclamer_demande') return { data: null, error: null };
        const p = params || {};
        if (p.p_client_id !== DEMANDE.id) return { data: { ok: false, code: 'RECLAMATION_REFUSEE' }, error: null };
        if (p.p_cle !== DEMANDE.hash) return { data: { ok: false, code: 'RECLAMATION_REFUSEE' }, error: null };
        DEMANDE.proprietaire = 'u-confirme';
        DEMANDE.hash = null;                    // le secret est consommé
        return { data: { ok: true, code: 'RATTACHEE', id: DEMANDE.id }, error: null };
      }
    };
    const r = await _hcReclamerDemandesEnAttente(client);
    let restant = [];
    try { restant = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    return { resultat: r, journal, proprietaire: DEMANDE.proprietaire,
             secretRestant: DEMANDE.hash, restant };
  });

  check('C15 : la réclamation est bien envoyée au serveur',
    apresConfirmation.journal.length === 1
      && apresConfirmation.journal[0].nom === 'reclamer_demande',
    JSON.stringify(apresConfirmation.journal.map(j => j.nom)));
  check('C16 : elle présente l\'identifiant ET le secret, jamais l\'adresse seule',
    apresConfirmation.journal[0]
      && !!apresConfirmation.journal[0].params.p_client_id
      && !!apresConfirmation.journal[0].params.p_cle
      && apresConfirmation.journal[0].params.p_email === undefined,
    JSON.stringify(apresConfirmation.journal[0] && Object.keys(apresConfirmation.journal[0].params)));
  check('C17 : la demande est RÉELLEMENT rattachée',
    apresConfirmation.proprietaire === 'u-confirme', String(apresConfirmation.proprietaire));
  check('C18 : le secret est consommé côté serveur',
    apresConfirmation.secretRestant === null, String(apresConfirmation.secretRestant));
  check('C19 : et il est effacé du navigateur',
    apresConfirmation.restant.length === 0, JSON.stringify(apresConfirmation.restant));
  check('C20 : le résultat est bien un succès', 
    apresConfirmation.resultat[0] && apresConfirmation.resultat[0].ok === true,
    JSON.stringify(apresConfirmation.resultat));

  // Un refus définitif efface aussi le secret : il ne sert plus à rien.
  const refusDefinitif = await c.page.evaluate(async () => {
    _hcMemoriserReclamation('id-refuse', 'k'.repeat(48), 'x@example.invalid');
    const client = { rpc: async () => ({ data: { ok: false, code: 'RECLAMATION_REFUSEE' }, error: null }) };
    await _hcReclamerDemandesEnAttente(client);
    try { return JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) { return 'illisible'; }
  });
  check('C21 : un refus définitif efface le secret devenu inutile',
    Array.isArray(refusDefinitif) && refusDefinitif.length === 0,
    JSON.stringify(refusDefinitif));

  // Un refus TEMPORAIRE, lui, le conserve : l'adresse n'est pas encore
  // confirmée, mais elle peut l'être demain.
  const refusTemporaire = await c.page.evaluate(async () => {
    _hcMemoriserReclamation('id-attente', 'k'.repeat(48), 'x@example.invalid');
    const client = { rpc: async () => ({ data: { ok: false, code: 'ADRESSE_NON_CONFIRMEE' }, error: null }) };
    await _hcReclamerDemandesEnAttente(client);
    let l = [];
    try { l = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    localStorage.removeItem('helixcar_reclamation');
    return l;
  });
  check('C22 : une adresse pas encore confirmée n\'efface RIEN — on réessaiera',
    refusTemporaire.length === 1 && refusTemporaire[0].id === 'id-attente',
    JSON.stringify(refusTemporaire));

  // Un secret périmé disparaît de lui-même, sans appel serveur.
  const perime = await c.page.evaluate(async () => {
    localStorage.setItem('helixcar_reclamation', JSON.stringify([
      { id: 'vieux', cle: 'k'.repeat(48), email: 'x@example.invalid', expire: Date.now() - 1000 }
    ]));
    let appels = 0;
    const client = { rpc: async () => { appels++; return { data: { ok: true }, error: null }; } };
    await _hcReclamerDemandesEnAttente(client);
    let l = [];
    try { l = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    return { appels, restant: l };
  });
  check('C23 : un secret périmé est oublié sans même interroger le serveur',
    perime.appels === 0 && perime.restant.length === 0, JSON.stringify(perime));

  await c.page.close();

  // ══ D. LE MESSAGE VIENT DU SERVEUR, PAS D'UNE DEVINETTE ══
  check('D1 : l\'écran lit la réponse du serveur',
    /_retour\.rattachee === true/.test(idx));
  check('D2 : il ne se fie pas à la seule présence d\'un utilisateur',
    !/utilisateur && utilisateur\.id[\s\S]{0,80}espace client/i.test(idx));
  check('D3 : le titre n\'affirme plus un compte créé avant de le savoir',
    !/hc-succes-titre[^>]*>Votre compte est créé/.test(idx));
  // LA PROMESSE DOIT ÊTRE TENUE PAR DU CODE, pas seulement écrite.
  check('D4 : la phrase « apparaîtra dans votre espace » est adossée à un vrai mécanisme',
    !/apparaîtra dans votre espace/.test(idx)
    || (/_hcMemoriserReclamation\(/.test(idx) && /_hcReclamerDemandesEnAttente\(/.test(idx)),
    'phrase présente sans mécanisme de réclamation');
  const mig99 = fs.readFileSync(fichier('migrations/99_reclamation_demande.sql'), 'utf8');
  check('D5 : le serveur exige une adresse RÉELLEMENT confirmée',
    /email_confirmed_at/.test(mig99) && /ADRESSE_NON_CONFIRMEE/.test(mig99));
  check('D6 : il exige que l\'adresse du compte soit celle de la demande',
    /lower\(btrim\(v_email\)\) <> lower\(btrim\(v_ligne\.email\)\)/.test(mig99));
  check('D7 : il n\'accepte qu\'une empreinte, jamais un secret en clair',
    /encode\(sha256/.test(mig99) && !/reclamation_cle\s+text/.test(mig99));
  check('D8 : le secret expire',
    /reclamation_expire_le <= now\(\)/.test(mig99) && /RECLAMATION_EXPIREE/.test(mig99));
  check('D9 : et il est consommé après réussite',
    /reclamation_cle_hash\s*=\s*null/.test(mig99));
  check('D10 : réclamer n\'est jamais accordé à un visiteur anonyme',
    /grant execute on function public\.reclamer_demande\(uuid, text\) to authenticated;/.test(mig99)
    && !/reclamer_demande\(uuid, text\) to anon/.test(mig99));
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  check('D11 : l\'espace client tente le rattachement à l\'ouverture de session',
    /_hcReclamerDemandesEnAttente\(sbAuth\)/.test(dash));
  check('D12 : et le site public aussi, au retour de confirmation',
    /_hcReclamerDemandesEnAttente\(_sb\)/.test(idx));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
