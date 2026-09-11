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
      window.__journal.push({
        op: 'signUp',
        email: ident && ident.email,
        retour: ident && ident.options && ident.options.emailRedirectTo
      });
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
      appelInscription: window.__journal.find(j => j.op === 'signUp') || null,
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
  check('C1 bis : avec confirmation requise, le retour vise aussi le Dashboard',
    c.etat.appelInscription && /\/dashboard\.html$/.test(c.etat.appelInscription.retour || ''),
    JSON.stringify(c.etat.appelInscription));
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
  // DEUX SECRETS, ET LE NAVIGATEUR NE GARDE QUE LE BON.
  //
  // Une première version n'en tirait qu'un seul : celui de création,
  // qui est une PREUVE DE REJEU. Le conserver trente jours suffisait,
  // sans aucune session, à rejouer creer_demande_avec_vehicules(), à en
  // relire le numéro client et à greffer des véhicules sur une demande
  // qui n'en avait pas. Ces trois contrôles interdisent le retour en
  // arrière.
  const parametres = (c.etat.appels[0] && c.etat.appels[0].params) || {};
  check('C13 : le secret conservé N\'EST PAS celui de création',
    !!parametres.p_cle_creation && enAttente[0]
      && enAttente[0].cle !== parametres.p_cle_creation,
    'conservé = ' + (enAttente[0] && enAttente[0].cle));
  check('C13 bis : c\'est bien le secret de RÉCLAMATION, envoyé à part',
    !!parametres.p_cle_reclamation && enAttente[0]
      && enAttente[0].cle === parametres.p_cle_reclamation,
    JSON.stringify(Object.keys(parametres)));
  check('C13 ter : les deux secrets sont réellement différents',
    !!parametres.p_cle_creation && !!parametres.p_cle_reclamation
      && parametres.p_cle_creation !== parametres.p_cle_reclamation);
  check('C14 : et l\'identifiant est celui de la demande écrite',
    enAttente[0] && c.etat.appels[0]
      && enAttente[0].id === c.etat.appels[0].params.p_demande.id);

  // Le secret de création ne doit se trouver NULLE PART dans le
  // navigateur — ni stockage local, ni stockage de session, ni cookie.
  const traces = await c.page.evaluate((cle) => {
    function tout(st) {
      var s = '';
      try { for (var i = 0; i < st.length; i++) s += st.key(i) + '=' + st.getItem(st.key(i)) + '\n'; }
      catch (e) {}
      return s;
    }
    return {
      local: tout(localStorage).indexOf(cle) !== -1,
      session: tout(sessionStorage).indexOf(cle) !== -1,
      cookie: String(document.cookie || '').indexOf(cle) !== -1
    };
  }, parametres.p_cle_creation || '\u0000introuvable');
  check('C14 bis : le secret de création n\'est écrit NULLE PART dans le navigateur',
    traces.local === false && traces.session === false && traces.cookie === false,
    JSON.stringify(traces));

  // Le client confirme son adresse, puis revient. Un double serveur qui
  // se comporte comme la migration 99 : il n'accepte que sur preuve.
  const apresConfirmation = await c.page.evaluate(async () => {
    const journal = [];
    const DEMANDE = { id: null, email: null, proprietaire: null, hash: null };
    let liste = [];
    try { liste = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    DEMANDE.id = liste[0] && liste[0].id;
    DEMANDE.email = liste[0] && liste[0].email;
    DEMANDE.hash = liste[0] && liste[0].cle;   // le double compare en clair

    // Session ouverte, adresse CONFIRMÉE. Le navigateur demande cette
    // adresse au serveur d'authentification avant toute réclamation :
    // le double doit donc la fournir, comme le vrai client Supabase.
    const client = {
      auth: {
        getUser: async function () {
          return { data: { user: { email: DEMANDE.email,
                                   email_confirmed_at: '2026-01-01T00:00:00Z' } } };
        }
      },
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
    const client = { auth: { getUser: async () => ({ data: { user: { email: 'x@example.invalid' } } }) },
                     rpc: async () => ({ data: { ok: false, code: 'RECLAMATION_REFUSEE' }, error: null }) };
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
    const client = { auth: { getUser: async () => ({ data: { user: { email: 'x@example.invalid' } } }) },
                     rpc: async () => ({ data: { ok: false, code: 'ADRESSE_NON_CONFIRMEE' }, error: null }) };
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
    const client = { auth: { getUser: async () => ({ data: { user: { email: 'x@example.invalid' } } }) },
                     rpc: async () => { appels++; return { data: { ok: true }, error: null }; } };
    await _hcReclamerDemandesEnAttente(client);
    let l = [];
    try { l = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    return { appels, restant: l };
  });
  check('C23 : un secret périmé est oublié sans même interroger le serveur',
    perime.appels === 0 && perime.restant.length === 0, JSON.stringify(perime));

  // ══ E. DEUX PERSONNES SUR LE MÊME APPAREIL ══
  //
  // Un ordinateur familial, un poste d'entreprise, un téléphone prêté :
  // deux demandes peuvent attendre côte à côte dans le même navigateur.
  //
  // La version précédente présentait TOUTES les réclamations à la
  // session ouverte. Le serveur refusait celle de l'autre — adresse
  // différente — et le navigateur prenait ce refus pour définitif : il
  // effaçait le secret. La demande du second devenait irrécupérable
  // AVANT MÊME qu'il ait confirmé son adresse.
  //
  // On rejoue ici le scénario exact, de bout en bout.
  const deuxComptes = await c.page.evaluate(async () => {
    localStorage.removeItem('helixcar_reclamation');
    const A = { id: 'demande-A', cle: 'A'.repeat(48), email: 'a@example.invalid' };
    const B = { id: 'demande-B', cle: 'B'.repeat(48), email: 'b@example.invalid' };
    _hcMemoriserReclamation(A.id, A.cle, A.email);
    // Volontairement saisie avec majuscules et espaces : le serveur
    // compare en lower(btrim(...)), le navigateur doit faire de même.
    _hcMemoriserReclamation(B.id, B.cle, '  B@Example.INVALID ');

    const base = {
      'demande-A': { email: 'a@example.invalid', cle: A.cle, proprietaire: null },
      'demande-B': { email: 'b@example.invalid', cle: B.cle, proprietaire: null }
    };
    const journal = [];

    // Un double qui se comporte comme la migration 99.
    function clientPour(adresse) {
      return {
        auth: { getUser: async () => ({ data: { user: {
          email: adresse, email_confirmed_at: '2026-01-01T00:00:00Z' } } }) },
        rpc: async (nom, p) => {
          journal.push({ session: adresse, nom: nom, id: p && p.p_client_id });
          if (nom !== 'reclamer_demande') return { data: null, error: null };
          const l = base[p.p_client_id];
          const normale = String(adresse).trim().toLowerCase();
          if (!l || l.proprietaire || l.email !== normale || l.cle !== p.p_cle) {
            return { data: { ok: false, code: 'RECLAMATION_REFUSEE' }, error: null };
          }
          l.proprietaire = normale;
          l.cle = null;                       // consommé
          return { data: { ok: true, code: 'RATTACHEE', id: p.p_client_id }, error: null };
        }
      };
    }

    const rA = await _hcReclamerDemandesEnAttente(clientPour('a@example.invalid'));
    let apresA = [];
    try { apresA = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}

    const rB = await _hcReclamerDemandesEnAttente(clientPour('B@Example.INVALID'));
    let apresB = [];
    try { apresB = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}

    localStorage.removeItem('helixcar_reclamation');
    return { journal, rA, rB, apresA, apresB, base, secretB: B.cle };
  });

  const appelsA = deuxComptes.journal.filter(j => j.session === 'a@example.invalid');
  const appelsB = deuxComptes.journal.filter(j => j.session === 'B@Example.INVALID');

  check('E1 : la session A ne présente QUE la réclamation de A',
    appelsA.length === 1 && appelsA[0].id === 'demande-A',
    JSON.stringify(deuxComptes.journal));
  check('E2 : la demande de A lui est bien rattachée',
    deuxComptes.base['demande-A'].proprietaire === 'a@example.invalid',
    String(deuxComptes.base['demande-A'].proprietaire));
  check('E3 : et son secret disparaît du navigateur',
    !deuxComptes.apresA.some(r => r.id === 'demande-A'),
    JSON.stringify(deuxComptes.apresA));
  // LE POINT DE L'AUDIT.
  check('E4 : la réclamation de B est laissée STRICTEMENT intacte',
    deuxComptes.apresA.length === 1
      && deuxComptes.apresA[0].id === 'demande-B'
      && deuxComptes.apresA[0].cle === deuxComptes.secretB,
    JSON.stringify(deuxComptes.apresA));
  check('E5 : B n\'a même jamais été présentée au serveur de A',
    !appelsA.some(j => j.id === 'demande-B'),
    JSON.stringify(appelsA));
  check('E6 : puis B ouvre sa session et réclame la sienne — et elle seule',
    appelsB.length === 1 && appelsB[0].id === 'demande-B',
    JSON.stringify(appelsB));
  check('E7 : la demande de B lui est rattachée à son tour',
    deuxComptes.base['demande-B'].proprietaire === 'b@example.invalid',
    String(deuxComptes.base['demande-B'].proprietaire));
  check('E8 : plus rien n\'attend dans le navigateur',
    deuxComptes.apresB.length === 0, JSON.stringify(deuxComptes.apresB));
  check('E9 : chaque demande n\'a qu\'un seul propriétaire, le bon',
    deuxComptes.base['demande-A'].proprietaire === 'a@example.invalid'
      && deuxComptes.base['demande-B'].proprietaire === 'b@example.invalid');
  check('E10 : les deux secrets ont été consommés côté serveur',
    deuxComptes.base['demande-A'].cle === null
      && deuxComptes.base['demande-B'].cle === null);
  check('E11 : une adresse saisie avec majuscules et espaces reste la bonne',
    deuxComptes.rB.length === 1 && deuxComptes.rB[0].ok === true,
    JSON.stringify(deuxComptes.rB));

  // Sans session lisible, on ne touche à RIEN : ni appel, ni effacement.
  const sansSession = await c.page.evaluate(async () => {
    _hcMemoriserReclamation('intacte', 'z'.repeat(48), 'z@example.invalid');
    let appels = 0;
    const client = { auth: { getUser: async () => ({ data: { user: null } }) },
                     rpc: async () => { appels++; return { data: { ok: false, code: 'RECLAMATION_REFUSEE' }, error: null }; } };
    await _hcReclamerDemandesEnAttente(client);
    let l = [];
    try { l = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    localStorage.removeItem('helixcar_reclamation');
    return { appels, restant: l };
  });
  check('E12 : sans adresse de session, aucun appel et aucun effacement',
    sansSession.appels === 0 && sansSession.restant.length === 1,
    JSON.stringify(sansSession));

  // Une entrée sans adresse ne pourrait jamais aboutir : elle n'est
  // même pas conservée.
  const sansAdresse = await c.page.evaluate(async () => {
    localStorage.removeItem('helixcar_reclamation');
    _hcMemoriserReclamation('sans-adresse', 'y'.repeat(48), '');
    let l = [];
    try { l = JSON.parse(localStorage.getItem('helixcar_reclamation') || '[]'); } catch (e) {}
    localStorage.removeItem('helixcar_reclamation');
    return l;
  });
  check('E13 : une réclamation sans adresse n\'est pas même enregistrée',
    sansAdresse.length === 0, JSON.stringify(sansAdresse));

  await c.page.close();

  // ══ D. LE MESSAGE VIENT DU SERVEUR, PAS D'UNE DEVINETTE ══
  check('D1 : l\'écran lit la réponse du serveur',
    /_retourSrv\.rattachee === true/.test(idx));
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
  // Le calcul de l'empreinte a été déplacé dans public.empreinte_secret
  // (migration 92) pour que la séparation des usages soit faite en UN
  // seul endroit. Ce qui doit rester vrai : aucune colonne ne garde le
  // secret en clair, et 99 ne hache jamais à sa façon.
  const migEmpreinte = fs.readFileSync(
    fichier('migrations/92_creation_demande_atomique.sql'), 'utf8');
  check('D7 : il n\'accepte qu\'une empreinte, jamais un secret en clair',
    /empreinte_secret\('reclamation'/.test(mig99)
    && /encode\(\s*\n?\s*sha256/.test(migEmpreinte)
    && !/reclamation_cle\s+text/.test(mig99));
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
  check('D12 bis : le retour de confirmation est construit depuis l\'origine réellement servie',
    /var HELIXCAR_URL_DASHBOARD = \(function \(\) \{[\s\S]*window\.location\.origin[\s\S]*return o \+ '\/dashboard\.html'/.test(idx));

  // ── D bis. LES DEUX SECRETS, VUS DEPUIS LES FICHIERS ──
  const mig92 = fs.readFileSync(fichier('migrations/92_creation_demande_atomique.sql'), 'utf8');
  check('D13 : la création reçoit un SECOND secret, distinct du premier',
    /p_cle_reclamation\s+text\s+default null/.test(mig92));
  check('D14 : et c\'est CELUI-LÀ qui arme la réclamation',
    /armer_reclamation\(v_id, p_cle_reclamation\)/.test(mig92)
    && !/armer_reclamation\(v_id, p_cle_creation\)/.test(mig92));
  check('D15 : les empreintes sont séparées par leur usage, pas par le hasard',
    /empreinte_secret\(\s*\n?\s*p_usage/.test(mig92)
    && /empreinte_secret\('creation', p_cle_creation\)/.test(mig92)
    && /empreinte_secret\('reclamation', p_cle\)/.test(mig99));
  check('D16 : une seule signature est publiée — pas d\'ambiguïté PostgREST',
    /drop function if exists public\.creer_demande_avec_vehicules\(jsonb, jsonb, text\);/.test(mig92)
    && /grant execute on function public\.creer_demande_avec_vehicules\(jsonb, jsonb, text, text\)/.test(mig92));
  check('D17 : au rattachement, l\'empreinte de création est effacée elle aussi',
    /creation_cle_hash\s*=\s*null/.test(mig99));
  check('D18 : le navigateur envoie bien les deux secrets, séparément',
    /p_cle_creation: cleCreation/.test(idx) && /p_cle_reclamation: cleReclamation/.test(idx));
  check('D19 : et il ne mémorise QUE celui de réclamation',
    /_hcMemoriserReclamation\(payload\.id, cleReclamation, email_val\)/.test(idx)
    && !/_hcMemoriserReclamation\([^)]*cleCreation/.test(idx));

  // ── D ter. UNE SESSION NE TOUCHE QUE SES PROPRES RÉCLAMATIONS ──
  [['index.html', idx], ['dashboard.html', dash]].forEach(function (paire) {
    const nom = paire[0], src = paire[1];
    check('D20 (' + nom + ') : l\'adresse de la session vient du serveur d\'authentification',
      /function _hcAdresseSession\(client\)/.test(src) && /auth\.getUser/.test(src));
    check('D21 (' + nom + ') : seules les réclamations de cette adresse sont tentées',
      /_hcNormaliserAdresse\(r\.email\) === adresse/.test(src));
    check('D22 (' + nom + ') : et l\'adresse est normalisée des deux côtés',
      /function _hcNormaliserAdresse\(x\)/.test(src) && /toLowerCase\(\)/.test(src));
  });

  // ── D quater. LE SYMPTÔME RAPPORTÉ NE PEUT PAS REVENIR ──
  // Après confirmation sur téléphone, une ancienne page affichait le
  // profil et les statistiques de démonstration « Marc Dupont ». Même
  // si la session ne possède encore aucune demande, l'interface doit
  // rester vide et se remplir uniquement avec les réponses serveur.
  check('D23 : aucun prénom ou nom Marc Dupont n\'est prérempli dans le profil client',
    !/id="profil-client-prenom"[^>]*value="Marc"/.test(dash)
    && !/id="profil-client-nom"[^>]*value="Dupont"/.test(dash));
  check('D24 : le titre client ne souhaite jamais la bienvenue à Marc par défaut',
    !/'client-dashboard'\s*:\s*\[\s*'Tableau de bord'\s*,\s*'Bienvenue Marc'\s*\]/.test(dash));
  check('D25 : missions et fidélité attendent leurs données serveur, sans statistiques de démonstration',
    /id="client-missions-resume"[^>]*>[\s\S]{0,120}Chargement/.test(dash)
    && /id="client-fidelite-carte"[^>]*>[\s\S]{0,120}Chargement/.test(dash)
    && /loadMissionsResumeClient\(\)/.test(dash)
    && /loadFideliteCarte\(\)/.test(dash));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
