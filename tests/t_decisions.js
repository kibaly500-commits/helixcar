// DÉCISIONS PAR ACTIVITÉ ET BLOCAGE PARTENAIRE
// Exécute le vrai code du Dashboard contre un double Supabase injecté
// AVANT les scripts de la page (le CDN supabase-js est injoignable ici).
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}

// Double Supabase : tables en mémoire, journal des écritures, et
// simulation des refus RLS selon le rôle déclaré.
const INIT = `
window.__db = { decisions: [], historique: [], convoyeurs: {}, emails: [] };
window.__role = 'admin';               // admin | partenaire | client
window.__journal = [];
// Lot A01 : la déconnexion renvoie au site public ; en file://, on observe
// la destination demandée au lieu de naviguer.
window.__retours = [];
window._hcRetourVitrine = function (motif) { window.__retours.push(motif || ''); };
window.__refusRls = function (table, operation) {
  if (window.__role === 'admin') return null;
  return { message: 'new row violates row-level security policy for table "' + table + '"' };
};
function _table(nom) {
  const req = { table: nom, filtres: {}, tri: null, limite: null };
  const api = {
    select() { return api; },
    eq(col, val) { req.filtres[col] = val; return api; },
    order(col, o) { req.tri = { col, asc: !!(o && o.ascending) }; return api; },
    limit(n) { req.limite = n; return api; },
    _lignes() {
      let src = nom === 'convoyeur_decisions' ? window.__db.decisions
              : nom === 'convoyeur_decisions_historique' ? window.__db.historique
              : Object.values(window.__db.convoyeurs);
      let out = src.filter(l => Object.entries(req.filtres).every(([k, v]) => l[k] === v));
      if (req.tri) out = out.slice().sort((a, b) =>
        (a[req.tri.col] > b[req.tri.col] ? 1 : -1) * (req.tri.asc ? 1 : -1));
      if (req.limite) out = out.slice(0, req.limite);
      return out;
    },
    then(resolve) {
      const refus = window.__refusRls(nom, 'select');
      if (refus) return Promise.resolve({ data: null, error: refus }).then(resolve);
      return Promise.resolve({ data: api._lignes(), error: null }).then(resolve);
    },
    async maybeSingle() {
      const refus = window.__refusRls(nom, 'select');
      if (refus) return { data: null, error: refus };
      const l = api._lignes()[0];
      return { data: l ? Object.assign({}, l) : null, error: null };
    },
    upsert(valeurs) {
      return {
        then(resolve) {
          const refus = window.__refusRls(nom, 'upsert');
          if (refus) { window.__journal.push({ op: 'upsert-refuse', nom }); return Promise.resolve({ error: refus }).then(resolve); }
          const existante = window.__db.decisions.find(d =>
            d.convoyeur_id === valeurs.convoyeur_id && d.activite === valeurs.activite);
          const ancienne = existante ? existante.decision : null;
          if (existante) existante.decision = valeurs.decision;
          else window.__db.decisions.push(Object.assign({}, valeurs));
          // Trigger d'historique : seules les vraies décisions y entrent.
          if (!(ancienne === null && valeurs.decision === 'en_attente')) {
            window.__db.historique.unshift({
              convoyeur_id: valeurs.convoyeur_id, activite: valeurs.activite,
              ancienne_decision: ancienne, nouvelle_decision: valeurs.decision,
              modifie_le: new Date().toISOString(), modifie_par: 'admin-test',
            });
          }
          window.__journal.push({ op: 'upsert', nom, valeurs: Object.assign({}, valeurs) });
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
    },
    update(valeurs) {
      const majApi = {
        eq(col, val) { req.filtres[col] = val; return majApi; },
        then(resolve) {
          const refus = window.__refusRls(nom, 'update');
          if (refus) { window.__journal.push({ op: 'update-refuse', nom }); return Promise.resolve({ error: refus }).then(resolve); }
          api._lignes().forEach(l => {
            Object.assign(l, valeurs);
            // Trigger : trace du blocage renseignée côté base.
            if ('bloque' in valeurs) {
              if (valeurs.bloque) { l.bloque_le = new Date().toISOString(); l.bloque_par = 'admin-test'; }
              else { l.bloque_le = null; l.bloque_par = null; l.bloque_motif = null; }
            }
          });
          window.__journal.push({ op: 'update', nom, valeurs: Object.assign({}, valeurs) });
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return majApi;
    },
  };
  return api;
}
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: { access_token: 'jwt-test' } } }; },
    signOut: async function () { window.__journal.push({ op: 'signOut' }); return {}; },
  },
  from: _table,
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: { message: 'non teste ici' } }; } }; } },
}; } };
// Double REST (PostgREST) : le Dashboard interroge convoyeurs via sbFetch(),
// pas via le client supabase-js. Sans ce double, sbFetch partirait sur le
// réseau, échouerait, et la vérification d'accès retomberait sur sa branche
// « incident réseau » — le test ne prouverait alors plus rien.
window.__rest = [];
const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  const marqueur = '/rest/v1/';
  const i = url.indexOf(marqueur);
  if (i === -1) return _fetchReel.apply(window, arguments);
  options = options || {};
  const requete = url.slice(i + marqueur.length);
  const chemin = requete.split('?')[0];
  const params = new URLSearchParams(requete.split('?')[1] || '');
  window.__rest.push({
    chemin: chemin,
    methode: (options.method || 'GET').toUpperCase(),
    // On garde l'en-tête pour vérifier que le JWT de session est bien
    // transmis : sans lui, auth.uid() vaudrait null et aucune policy
    // d'identité ne pourrait s'appliquer.
    autorisation: (options.headers || {})['Authorization'] || '',
  });
  let lignes = [];
  if (chemin === 'convoyeurs') {
    lignes = Object.values(window.__db.convoyeurs);
    params.forEach(function (valeur, cle) {
      if (cle.charAt(0) === '$' || ['select', 'order', 'limit', 'offset'].indexOf(cle) !== -1) return;
      if (valeur.indexOf('eq.') === 0) {
        const attendu = decodeURIComponent(valeur.slice(3));
        lignes = lignes.filter(function (l) { return String(l[cle]) === attendu; });
      }
    });
  }
  return Promise.resolve({
    ok: true, status: 200,
    text: function () { return Promise.resolve(JSON.stringify(lignes)); },
  });
};
// EmailJS instrumenté : toute tentative d'envoi serait enregistrée.
window.emailjs = { send: function () { window.__db.emails.push(Array.from(arguments)); return Promise.resolve(); },
                   init: function () {}, sendForm: function () { window.__db.emails.push(['form']); return Promise.resolve(); } };
`;

function candidat(id, prenom, activites, extra) {
  return Object.assign({
    id, prenom, nom: 'Test', email: prenom.toLowerCase() + '@example.invalid',
    telephone: '+33600000000', activites, statut: 'en_attente', bloque: false,
  }, extra || {});
}

(async () => {
  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());   // confirm() accepté par défaut
  await page.addInitScript(INIT);
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });

  const UN = candidat('c-1', 'Alice', ['convoyage']);
  const DEUX = candidat('c-2', 'Bruno', ['convoyage', 'nettoyage']);
  const TROIS = candidat('c-3', 'Chloe', ['convoyage', 'nettoyage', 'renfort']);
  await page.evaluate(([a, b, c]) => {
    window._candidaturesData = {};
    [a, b, c].forEach(x => { window._candidaturesData[x.id] = x; window.__db.convoyeurs[x.id] = Object.assign({}, x); });
  }, [UN, DEUX, TROIS]);

  async function ouvrir(id) {
    await page.evaluate(i => openDossierSb(i), id);
    await page.waitForTimeout(220);
  }
  async function lireBoutons() {
    return page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#dossier-decisions [data-decision-activite]').forEach(sp => {
        const act = sp.getAttribute('data-decision-activite');
        out[act] = {};
        sp.querySelectorAll('button[data-decision]').forEach(b => {
          out[act][b.getAttribute('data-decision')] = b.getAttribute('aria-pressed') === 'true';
        });
      });
      return out;
    });
  }
  async function decider(activite, valeur) {
    await page.evaluate(([a, v]) => changerDecisionActivite(a, v), [activite, valeur]);
    await page.waitForTimeout(200);
  }
  async function db() { return page.evaluate(() => JSON.parse(JSON.stringify(window.__db))); }

  // ── A. Une, deux, trois activités ──
  await ouvrir('c-1');
  let b = await lireBoutons();
  check('A1 : 1 activité -> 1 bloc de décision', Object.keys(b).length === 1, JSON.stringify(Object.keys(b)));
  check('A2 : 3 boutons (Oui / Non / En attente)', Object.keys(b.convoyage || {}).length === 3, JSON.stringify(b));
  check('A3 : valeur par défaut = En attente', b.convoyage && b.convoyage.en_attente === true, JSON.stringify(b.convoyage));

  await ouvrir('c-2');
  b = await lireBoutons();
  check('A4 : 2 activités -> 2 blocs indépendants',
    Object.keys(b).length === 2 && b.convoyage && b.nettoyage, JSON.stringify(Object.keys(b)));

  await ouvrir('c-3');
  b = await lireBoutons();
  check('A5 : 3 activités -> 3 blocs', Object.keys(b).length === 3, JSON.stringify(Object.keys(b)));
  const fiches = await page.evaluate(() => document.querySelectorAll('#dossier-content').length);
  check('A6 : une SEULE fiche par candidat', fiches === 1);
  const texte = await page.evaluate(() => document.getElementById('dossier-content').textContent);
  check('A7 : toutes les activités affichées dans la fiche',
    /Convoyage/i.test(texte) && /Nettoyage/i.test(texte) && /Renfort/i.test(texte), texte.slice(0, 200));

  // ── B. Décisions différentes par activité ──
  await decider('convoyage', 'oui');
  await decider('nettoyage', 'non');
  b = await lireBoutons();
  check('B1 : Convoyage = Oui', b.convoyage.oui === true);
  check('B2 : Nettoyage = Non', b.nettoyage.non === true);
  check('B3 : Renfort reste En attente (jamais modifié par les autres)',
    b.renfort.en_attente === true && b.renfort.oui === false && b.renfort.non === false, JSON.stringify(b.renfort));

  let base = await db();
  const dec3 = base.decisions.filter(d => d.convoyeur_id === 'c-3');
  check('B4 : décisions réellement enregistrées', dec3.length === 2, JSON.stringify(dec3));
  check('B5 : aucune décision créée pour une activité non décidée',
    !dec3.some(d => d.activite === 'renfort'));

  // ── C. Tous les passages ──
  await decider('convoyage', 'non');            // oui -> non
  b = await lireBoutons(); check('C1 : Oui -> Non', b.convoyage.non === true);
  await decider('convoyage', 'en_attente');     // non -> en attente
  b = await lireBoutons(); check('C2 : Non -> En attente', b.convoyage.en_attente === true);
  await decider('convoyage', 'oui');            // en attente -> oui
  b = await lireBoutons(); check('C3 : En attente -> Oui', b.convoyage.oui === true);
  await decider('nettoyage', 'oui');            // non -> oui
  b = await lireBoutons(); check('C4 : Non -> Oui', b.nettoyage.oui === true);
  await decider('nettoyage', 'en_attente');     // oui -> en attente
  b = await lireBoutons(); check('C5 : Oui -> En attente', b.nettoyage.en_attente === true);
  await decider('renfort', 'non');              // en attente -> non
  b = await lireBoutons(); check('C6 : En attente -> Non', b.renfort.non === true);

  // ── D. Confirmation et annulation ──
  base = await db();
  const avantAnnulation = JSON.stringify(base.decisions);
  page.removeAllListeners('dialog');
  const messages = [];
  page.on('dialog', d => { messages.push(d.message()); d.dismiss(); });   // ANNULATION
  await decider('renfort', 'oui');
  base = await db();
  check('D1 : annulation -> AUCUNE écriture', JSON.stringify(base.decisions) === avantAnnulation);
  b = await lireBoutons();
  check('D2 : annulation -> affichage inchangé', b.renfort.non === true);
  const msg = messages.join(' | ');
  check('D3 : la confirmation nomme le candidat', /Chloe/.test(msg), msg);
  check('D4 : la confirmation nomme l\'activité', /Renfort automobile sur site/.test(msg), msg);
  check('D5 : la confirmation indique l\'ancienne décision', /Décision actuelle\s*:\s*Non/.test(msg), msg);
  check('D6 : la confirmation indique la nouvelle décision', /Nouvelle décision\s*:\s*Oui/.test(msg), msg);
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());

  // ── E. Historique ──
  base = await db();
  const histo = base.historique.filter(h => h.convoyeur_id === 'c-3');
  check('E1 : historique alimenté', histo.length >= 6, 'entrées=' + histo.length);
  const complet = histo.every(h => h.activite && h.nouvelle_decision && h.modifie_le && h.modifie_par);
  check('E2 : chaque entrée porte activité, nouvelle décision, date et auteur', complet, JSON.stringify(histo[0]));
  check('E3 : l\'ancienne décision est conservée',
    histo.some(h => h.ancienne_decision === 'oui' && h.nouvelle_decision === 'non'), JSON.stringify(histo));
  const histoAffiche = await page.evaluate(() =>
    (document.getElementById('dossier-decisions') || {}).textContent || '');
  check('E4 : historique affiché dans la fiche', /Historique des décisions/.test(histoAffiche));
  check('E5 : historique lisible (activité et transition)',
    /Convoyage automobile/.test(histoAffiche) && /→/.test(histoAffiche), histoAffiche.slice(-200));

  // ── F. Persistance ──
  await ouvrir('c-3');   // réouverture : relit depuis la base
  b = await lireBoutons();
  check('F1 : décisions rechargées à la réouverture',
    b.convoyage.oui === true && b.nettoyage.en_attente === true && b.renfort.non === true, JSON.stringify(b));

  await page.reload({ waitUntil: 'load' });      // F5 réel
  await page.waitForTimeout(300);
  await page.evaluate(([a, b2, c]) => {
    window._candidaturesData = {};
    [a, b2, c].forEach(x => { window._candidaturesData[x.id] = x; });
  }, [UN, DEUX, TROIS]);
  // La base du double survit-elle ? Non : on la recharge comme le ferait Supabase.
  await page.evaluate(d => { window.__db = d; }, base);
  await ouvrir('c-3');
  b = await lireBoutons();
  check('F2 : décisions conservées après F5',
    b.convoyage.oui === true && b.renfort.non === true, JSON.stringify(b));

  // ── G. Blocage réel ──
  await ouvrir('c-3');
  let etatBtn = await page.evaluate(() => ({
    texte: (document.getElementById('dossier-btn-block') || {}).textContent,
    bloque: window._currentConvBlocked,
  }));
  check('G1 : bouton reflète l\'état réel (non bloqué)',
    /Bloquer/.test(etatBtn.texte) && etatBtn.bloque === false, JSON.stringify(etatBtn));

  await page.evaluate(() => {
    document.getElementById('block-reason-group').style.display = 'block';
    document.getElementById('block-reason').value = 'Documents expirés';
    return toggleBlockConvoyeur();
  });
  await page.waitForTimeout(220);
  base = await db();
  let ligne = base.convoyeurs['c-3'];
  check('G2 : blocage RÉELLEMENT enregistré', ligne.bloque === true, JSON.stringify(ligne));
  check('G3 : motif enregistré', ligne.bloque_motif === 'Documents expirés');
  check('G4 : trace de qui et quand', !!ligne.bloque_le && !!ligne.bloque_par, JSON.stringify(ligne));
  etatBtn = await page.evaluate(() => (document.getElementById('dossier-btn-block') || {}).textContent);
  check('G5 : bouton bascule sur Débloquer', /Débloquer/.test(etatBtn), etatBtn);

  // Déblocage : ne touche pas aux décisions
  const decisionsAvantDeblocage = JSON.stringify((await db()).decisions);
  await page.evaluate(() => toggleBlockConvoyeur());
  await page.waitForTimeout(220);
  base = await db();
  ligne = base.convoyeurs['c-3'];
  check('G6 : déblocage enregistré', ligne.bloque === false);
  check('G7 : déblocage efface la trace de blocage',
    !ligne.bloque_le && !ligne.bloque_par && !ligne.bloque_motif, JSON.stringify(ligne));
  check('G8 : déblocage ne modifie AUCUNE décision',
    JSON.stringify(base.decisions) === decisionsAvantDeblocage);
  check('G9 : déblocage n\'accepte pas les activités en attente ou refusées',
    base.decisions.filter(d => d.convoyeur_id === 'c-3')
      .every(d => ['oui', 'non', 'en_attente'].includes(d.decision))
    && base.decisions.some(d => d.convoyeur_id === 'c-3' && d.decision === 'non'),
    JSON.stringify(base.decisions.filter(d => d.convoyeur_id === 'c-3')));

  // ── H. Autorisations ──
  await page.evaluate(() => { window.__role = 'partenaire'; window.__journal = []; });
  const refusPartenaire = await page.evaluate(async () => {
    try { await enregistrerDecisionPartenaire('c-3', 'convoyage', 'oui'); return { ecrit: true }; }
    catch (e) { return { ecrit: false, message: e.message }; }
  });
  check('H1 : un partenaire ne peut PAS écrire une décision',
    refusPartenaire.ecrit === false && /row-level security/i.test(refusPartenaire.message), JSON.stringify(refusPartenaire));

  const refusBlocage = await page.evaluate(async () => {
    try { await definirBlocagePartenaire('c-3', true, 'auto-déblocage'); return { ecrit: true }; }
    catch (e) { return { ecrit: false, message: e.message }; }
  });
  check('H2 : un partenaire ne peut PAS modifier son blocage',
    refusBlocage.ecrit === false && /row-level security/i.test(refusBlocage.message), JSON.stringify(refusBlocage));

  await page.evaluate(() => { window.__role = 'client'; });
  const refusClient = await page.evaluate(async () => {
    try { const d = await chargerDecisionsPartenaire('c-3'); return { lu: true, d: d }; }
    catch (e) { return { lu: false, message: e.message }; }
  });
  check('H3 : un client ne peut PAS lire les décisions',
    refusClient.lu === false && /row-level security/i.test(refusClient.message), JSON.stringify(refusClient));

  await page.evaluate(() => { window.__role = 'admin'; });
  const okAdmin = await page.evaluate(async () => {
    try { const d = await chargerDecisionsPartenaire('c-3'); return { lu: true, n: Object.keys(d).length }; }
    catch (e) { return { lu: false, message: e.message }; }
  });
  check('H4 : un administrateur autorisé lit les décisions', okAdmin.lu === true && okAdmin.n >= 2, JSON.stringify(okAdmin));

  // ── I. Session partenaire déjà ouverte ──
  await page.evaluate(() => {
    window.__db.convoyeurs['c-3'].bloque = true;
    window.__db.convoyeurs['c-3'].statut = 'actif';
    currentRole = 'convoyeur';
    window._currentConvoyeur = { id: 'c-3' };
    window.__journal = [];
    window.__alertes = [];
  });
  page.removeAllListeners('dialog');
  const alertes = [];
  page.on('dialog', d => { alertes.push(d.message()); d.accept(); });
  const acces = await page.evaluate(async () => await verifierAccesPartenaireEnCours());
  await page.waitForTimeout(200);
  check('I1 : session ouverte + blocage -> accès refusé à la vérification suivante', acces === false);
  const journal = await page.evaluate(() => window.__journal);
  check('I2 : la session est réellement fermée (signOut)',
    journal.some(j => j.op === 'signOut'), JSON.stringify(journal));
  check('I3 : message neutre, sans détail technique',
    alertes.some(m => /accès à votre compte est suspendu/i.test(m))
    && !alertes.some(m => /row-level|policy|sql|supabase/i.test(m)), alertes.join(' | '));

  // La déconnexion a oublié le partenaire courant : on rouvre une session
  // pour que I4 vérifie réellement le cas « non bloqué » et ne passe pas
  // simplement parce qu'il n'y a plus de session à contrôler.
  await page.evaluate(() => {
    window.__db.convoyeurs['c-3'].bloque = false;
    currentRole = 'convoyeur';
    window._currentConvoyeur = { id: 'c-3' };
    window.__journal = [];
  });
  const accesOk = await page.evaluate(async () => await verifierAccesPartenaireEnCours());
  const journalOk = await page.evaluate(() => window.__journal);
  check('I4 : partenaire actif non bloqué -> accès maintenu, session conservée',
    accesOk === true && !journalOk.some(j => j.op === 'signOut'), JSON.stringify(journalOk));
  // Les politiques RLS de la migration 05 reposent sur auth.uid(). Si le
  // Dashboard continuait d'envoyer la clé anon, auth.uid() vaudrait null
  // et le blocage serveur ne s'appliquerait jamais.
  const appelsRest = await page.evaluate(() => window.__rest);
  check('I5 : les appels REST portent le JWT de la session, pas la clé anon',
    appelsRest.length > 0 && appelsRest.every(a => a.autorisation === 'Bearer jwt-test'),
    JSON.stringify(appelsRest.slice(0, 3)));
  await page.evaluate(() => { currentRole = 'admin'; });
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());

  // ── J. Aucun email ──
  base = await db();
  check('J1 : AUCUN email envoyé par les décisions ou le blocage',
    base.emails.length === 0, 'emails=' + base.emails.length);
  const fs = require('fs');
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  const bloc = dash.slice(dash.indexOf('DÉCISIONS PAR ACTIVITÉ ET BLOCAGE PARTENAIRE'),
                          dash.indexOf('VIDÉO DE CANDIDATURE — LECTURE SÉCURISÉE'));
  check('J2 : le code des décisions/blocage n\'appelle jamais EmailJS',
    !/emailjs\.(send|sendForm)/.test(bloc));
  check('J3 : plus aucune annonce mensongère d\'email envoyé',
    !/Un email de notification lui a été envoyé|Un email lui a été envoyé/.test(dash));

  check('Aucune erreur JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (echecs.length) echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail > 0 ? 1 : 0);
})();
