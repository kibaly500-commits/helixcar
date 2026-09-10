// ENVOI DU DEVIS DEPUIS LE DASHBOARD (lot Q01)
// ------------------------------------------------------------------
// Exécute le VRAI code du Dashboard contre un double Supabase en
// mémoire et un double de la fonction devis-secure. Aucun réseau, aucun
// e-mail, aucune donnée réelle.
//
// Ce que ce fichier prouve, sur le défaut réel « Identifiant interne du
// devis introuvable (d.id absent). Envoi impossible. » :
//   * REPRODUCTION : l'ancienne insertion (return=minimal) laissait en
//     mémoire un devis SANS identifiant — l'envoi immédiat échouait ;
//   * l'insertion relit désormais l'identifiant canonique, l'envoi
//     fonctionne immédiatement, après rechargement, et après une perte
//     de l'objet en mémoire (récupération serveur, jamais un 2e devis) ;
//   * si l'identifiant manque VRAIMENT : erreur HelixCar intégrée,
//     aucune alerte native, aucun PREPARE, aucun changement de statut ;
//   * double clic = une seule intention ; renvoi explicite tracé ;
//   * le bouton QA a disparu ; plus d'URL de fonction codée en dur.
const { lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 260) + ']' : '')); fail++; echecs.push(l); }
}

const DEMANDE = {
  id: 'c0c0c0c0-0000-4000-8000-000000000001', numero_client: 'HC-QA-0062', prenom: 'TEST-QA-CLAUDE-HELIXCAR', nom: 'Client',
  email: 'test-qa-claude-helixcar@example.invalid', telephone: '+33600000000', type_client: 'pro',
  societe: 'TEST-QA Flotte SAS', type_service: 'convoyage', statut: 'nouveau', nb_vehicules: 1, trajet_commun: false,
  ville_depart: 'Paris', ville_arrivee: 'Lyon', created_at: '2026-09-09T09:00:00Z', _vehicules: []
};

const INIT = `
window.__pdfTextes = [];
window.jspdf = { jsPDF: function () {
  var self = this; window.__pdfTextes = [];
  this.internal = { pageSize: { getWidth: function(){return 210;}, getHeight: function(){return 297;} } };
  this.text = function (s) { window.__pdfTextes.push(String(s)); return self; };
  ['setFont','setFontSize','setTextColor','setFillColor','setDrawColor','setLineWidth','setLineDashPattern',
   'rect','roundedRect','circle','line','addImage','setPage','save'].forEach(function (m) { self[m] = function(){ return self; }; });
  this.addPage = function(){ window.__pdfPages = (window.__pdfPages||1)+1; return self; };
  this.getNumberOfPages = function(){ return window.__pdfPages||1; };
  this.getTextWidth = function (s) { return String(s).length * 1.9; };
  this.splitTextToSize = function (s, w) { s = String(s); var max = Math.max(8, Math.floor(w / 1.9)); var mots = s.split(' '), out = [], cur = '';
    mots.forEach(function (m) { if ((cur + ' ' + m).trim().length > max) { if (cur) out.push(cur); cur = m; } else cur = (cur ? cur + ' ' : '') + m; });
    if (cur) out.push(cur); return out.length ? out : ['']; };
  this.output = function(){ return 'data:application/pdf;base64,' + btoa('%PDF-1.4 ' + 'x'.repeat(2000)); };
} };
window.__emails = [];
window.emailjs = { init: function(){}, send: function(){ window.__emails.push(1); return Promise.resolve(); }, sendForm: function(){ window.__emails.push(1); return Promise.resolve(); } };
window.__alertes = []; window.alert = function (m) { window.__alertes.push(String(m)); };
window.__confirmations = []; window.confirm = function (m) { window.__confirmations.push(String(m)); return window.__confirmer !== false; };
window.__prompt = null; window.prompt = function () { return window.__prompt; };

// ── Double Supabase : la table devis, avec le trigger de version ──
window.__db = { devis: [], devis_envois: [] };
window.__insertionSansRelecture = false;   // reproduit l'ancien return=minimal
window.__recuperationVide = false;         // la relecture serveur ne rend rien
window.__requetes = [];
function _table(nom) {
  const req = { filtres: [], tri: null, limite: null, op: 'select', valeurs: null, relecture: false };
  const lignes = () => {
    let out = (window.__db[nom] || []).filter(l => req.filtres.every(f => f(l)));
    if (req.tri) out = out.slice().sort((a, b) => ((a[req.tri.col] > b[req.tri.col]) ? 1 : -1) * (req.tri.asc ? 1 : -1));
    if (req.limite != null) out = out.slice(0, req.limite);
    return out;
  };
  function executer() {
    window.__requetes.push({ table: nom, op: req.op, relecture: req.relecture, valeurs: req.valeurs ? Object.assign({}, req.valeurs) : null });
    if (req.op === 'select') {
      if (nom === 'devis' && window.__recuperationVide) return { data: [], error: null };
      return { data: lignes().map(l => Object.assign({}, l)), error: null };
    }
    if (req.op === 'insert') {
      const l = Object.assign({ id: 'd-' + Math.random().toString(36).slice(2), version: 1, paiement_statut: 'aucun' }, req.valeurs);
      window.__db[nom].push(l);
      if (window.__insertionSansRelecture || !req.relecture) return { data: null, error: null };
      return { data: [Object.assign({}, l)], error: null };
    }
    if (req.op === 'update') {
      const cibles = lignes();
      cibles.forEach(l => { if ('prix' in req.valeurs && req.valeurs.prix !== l.prix) l.version = (l.version || 1) + 1; Object.assign(l, req.valeurs); });
      return { data: req.relecture ? cibles.map(l => Object.assign({}, l)) : null, error: null };
    }
    return { data: null, error: { message: 'op' } };
  }
  const api = {
    select() { req.relecture = true; return api; },
    eq(c, v) { req.filtres.push(l => String(l[c]) === String(v)); return api; },
    order(c, o) { req.tri = { col: c, asc: !!(o && o.ascending) }; return api; },
    limit(n) { req.limite = n; return api; },
    range(a, b) { req.limite = b - a + 1; return api; },
    insert(v) { req.op = 'insert'; req.valeurs = v; return api; },
    update(v) { req.op = 'update'; req.valeurs = v; return api; },
    then(res, rej) { return Promise.resolve(executer()).then(res, rej); },
    maybeSingle: async function () { const r = executer(); return { data: (r.data || [])[0] || null, error: r.error }; },
    single: async function () { const r = executer(); const l = (r.data || [])[0]; return l ? { data: l, error: null } : { data: null, error: { message: 'no rows' } }; },
  };
  return api;
}
window.supabase = { createClient: function () { return {
  auth: { onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          getSession: async function () { return { data: { session: { access_token: 'jwt-admin-test' } } }; } },
  from: _table,
  rpc: async function () { return { data: null, error: null }; },
  storage: { from: function () { return {}; } },
}; } };

// ── Double de la fonction devis-secure et de PostgREST ──
window.__fonction = [];
window.__fonctionKo = null;   // { action, statut, corps }
const _f = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  if (url.indexOf('/functions/v1/devis-secure') !== -1) {
    const corps = JSON.parse((options && options.body) || '{}');
    window.__fonction.push({ action: corps.action, corps: corps, auth: (options.headers || {})['Authorization'] || '' });
    if (window.__fonctionKo && window.__fonctionKo.action === corps.action) {
      const ko = window.__fonctionKo;
      return Promise.resolve({ ok: false, status: ko.statut, json: function () { return Promise.resolve(ko.corps); } });
    }
    let rep;
    if (corps.action === 'prepare') rep = { ok: true, token: 'jeton-prepare-' + Math.random().toString(36).slice(2), date_expiration_token: '2027-01-01T00:00:00Z', version: 1 };
    else if (corps.action === 'send_email') {
      const d = window.__db.devis.find(x => x.id === corps.devis_id);
      if (d) { d.statut = 'envoye'; d.date_envoi = '2026-09-10T10:00:00Z'; d.version_envoyee = d.version || 1; }
      window.__db.devis_envois.push({ devis_id: corps.devis_id, etape: 'acceptee_prestataire', version: 1, destinataire: 'test-qa-claude-helixcar@example.invalid', renvoi: !!corps.renvoi, created_at: '2026-09-10T10:00:00Z' });
      rep = { ok: true, statut: 'envoye', date_envoi: '2026-09-10T10:00:00Z', version_envoyee: 1 };
    } else rep = { ok: false, code: 'BAD_REQUEST' };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(rep); } });
  }
  if (url.indexOf('/rest/v1/') !== -1) {
    return Promise.resolve({ ok: true, status: 200, headers: { get: function(){ return 'items 0-0/0'; } }, text: function(){ return Promise.resolve('[]'); } });
  }
  return _f.apply(window, arguments);
};
`;

(async () => {
  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
  await page.evaluate((dem) => {
    document.getElementById('login-screen') && (document.getElementById('login-screen').style.display = 'none');
    window._demandesDevisListe = [dem];
    window._devisParClient = {};
  }, DEMANDE);

  const fiche = () => page.evaluate(() => ({
    html: (document.getElementById('fiche-demande-corps') || {}).innerHTML || '',
    texte: (document.getElementById('fiche-demande-corps') || {}).textContent || '',
    erreur: (document.getElementById('devis-erreur-envoi') || {}).textContent || '',
    erreurVisible: !!(document.getElementById('devis-erreur-envoi') && document.getElementById('devis-erreur-envoi').classList.contains('visible')),
    succes: (document.getElementById('devis-succes-envoi') || {}).textContent || '',
    bouton: (document.getElementById('btn-envoyer-devis') || {}).textContent || null,
    boutonDesactive: !!(document.getElementById('btn-envoyer-devis') && document.getElementById('btn-envoyer-devis').disabled),
  }));
  const devisMemoire = () => page.evaluate((id) => Object.assign({}, window._devisParClient[id] || null), DEMANDE.id);
  const appels = () => page.evaluate(() => window.__fonction.map(a => a.action));
  const rearmer = () => page.evaluate(() => { window.__fonction = []; window.__alertes = []; window.__confirmations = []; window.__requetes = []; });

  // ── A. REPRODUCTION sur le Dashboard d'origin/main, avec le MÊME double ──
  // L'ancien code insérait sans relire (return=minimal) et gardait en
  // mémoire un devis sans identifiant : l'envoi immédiat affichait
  // « Identifiant interne du devis introuvable (d.id absent) ».
  const { execSync } = require('child_process');
  const path = require('path');
  const os = require('os');
  let ancienChemin = null;
  try {
    const ancien = execSync('git show origin/main:dashboard.html', { cwd: RACINE, maxBuffer: 64 * 1024 * 1024 }).toString();
    ancienChemin = path.join(os.tmpdir(), 'helixcar-dashboard-origin-main-' + process.pid + '.html');
    fs.writeFileSync(ancienChemin, ancien);
  } catch (e) { ancienChemin = null; }
  if (ancienChemin) {
    const pageAncienne = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await pageAncienne.addInitScript(INIT);
    await pageAncienne.goto('file://' + ancienChemin, { waitUntil: 'load' });
    await pageAncienne.evaluate((dem) => {
      document.getElementById('login-screen') && (document.getElementById('login-screen').style.display = 'none');
      window._demandesDevisListe = [dem]; window._devisParClient = {};
    }, DEMANDE);
    await pageAncienne.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
    await pageAncienne.waitForTimeout(80);
    await pageAncienne.fill('#devis-prix-input', '450');
    await pageAncienne.evaluate((id) => genererDevis(id), DEMANDE.id);
    await pageAncienne.waitForTimeout(250);
    const dAncien = await pageAncienne.evaluate((id) => Object.assign({}, window._devisParClient[id] || null), DEMANDE.id);
    check('A1 : REPRODUCTION (origin/main) — après génération, le devis en mémoire n\'a PAS d\'identifiant',
      dAncien && dAncien.reference && !dAncien.id, JSON.stringify(dAncien));
    await pageAncienne.evaluate((id) => envoyerDevis(id), DEMANDE.id);
    await pageAncienne.waitForTimeout(250);
    const alertes = await pageAncienne.evaluate(() => window.__alertes.slice());
    const appelsAnciens = await pageAncienne.evaluate(() => window.__fonction.map(a => a.action));
    check('A2 : REPRODUCTION (origin/main) — l\'envoi immédiat échoue : « Identifiant interne du devis introuvable », aucun PREPARE',
      alertes.some(a => /Identifiant interne du devis introuvable/.test(a)) && appelsAnciens.length === 0, JSON.stringify({ alertes, appelsAnciens }));
    check('A3 : REPRODUCTION (origin/main) — le bouton « Tester PREPARE (QA) » existait dans la fiche',
      /Tester PREPARE/.test(await pageAncienne.evaluate(() => document.getElementById('fiche-demande-corps').innerHTML)));
    await pageAncienne.close();
    try { fs.unlinkSync(ancienChemin); } catch (e) {}
  } else {
    console.log('A1-A3 : reproduction sur origin/main non exécutée (historique git indisponible)');
  }

  // ── A bis. Relecture vide après insertion : RÉCUPÉRATION, jamais un 2e devis ──
  await page.evaluate(() => { window.__insertionSansRelecture = true; });
  await page.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
  await page.waitForTimeout(80);
  await page.fill('#devis-prix-input', '450');
  await page.evaluate((id) => genererDevis(id), DEMANDE.id);
  await page.waitForTimeout(250);
  let d = await devisMemoire();
  check('A4 : si la relecture après insertion est vide, l\'identifiant est RÉCUPÉRÉ par la relation demande/référence',
    d && d.id && d.reference, JSON.stringify(d));
  check('A5 : ... aucune alerte native, aucune erreur affichée, un seul devis en base',
    (await page.evaluate(() => window.__alertes.length)) === 0 && !(await fiche()).erreurVisible
    && (await page.evaluate(() => window.__db.devis.length)) === 1);
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  d = await devisMemoire();
  let a = await appels();
  check('A6 : l\'envoi immédiat fonctionne : PREPARE puis SEND_EMAIL', a.join(',') === 'prepare,send_email', JSON.stringify(a));
  const prep = await page.evaluate(() => window.__fonction[0].corps);
  check('A7 : PREPARE reçoit l\'identifiant CANONIQUE, pas la référence humaine', prep.devis_id === d.id && prep.devis_id !== d.reference && /^d-/.test(prep.devis_id));
  const env = await page.evaluate(() => window.__fonction[1].corps);
  check('A8 : SEND_EMAIL porte une clé de tentative et renvoi=false au premier envoi', typeof env.envoi_cle === 'string' && env.envoi_cle.length >= 8 && env.renvoi === false);
  check('A9 : la récupération n\'a créé AUCUN second devis', (await page.evaluate(() => window.__db.devis.length)) === 1);
  let f = await fiche();
  check('A10 : succès affiché par le composant HelixCar, statut « envoyé », bouton « Renvoyer au client »',
    /envoyé/i.test(f.succes) && /réception en boîte n'est pas prouvée/i.test(f.succes) && f.bouton === 'Renvoyer au client'
    && (await page.evaluate(() => window.__alertes.length)) === 0, JSON.stringify(f));
  check('A11 : l\'historique des envois est affiché', /Historique des envois/.test(f.texte) && /accepté par le prestataire/i.test(f.texte));

  // ── B. Le correctif : la génération relit l'identifiant ──
  await page.evaluate(() => { window.__insertionSansRelecture = false; window.__db = { devis: [], devis_envois: [] }; window._devisParClient = {}; });
  await rearmer();
  await page.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
  await page.waitForTimeout(80);
  await page.fill('#devis-prix-input', '450');
  await page.evaluate((id) => genererDevis(id), DEMANDE.id);
  await page.waitForTimeout(250);
  d = await devisMemoire();
  check('B1 : après génération, l\'identifiant canonique est en mémoire immédiatement', !!d.id && d.statut === 'genere' && d.version === 1, JSON.stringify(d));
  const ins = await page.evaluate(() => window.__requetes.find(r => r.op === 'insert'));
  check('B2 : l\'insertion demande la RELECTURE de la ligne (plus de return=minimal)', ins && ins.relecture === true, JSON.stringify(ins));
  check('B3 : aucune erreur affichée', !(await fiche()).erreurVisible);
  // Envoi immédiat, sans aucune récupération nécessaire.
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  check('B4 : envoi immédiat -> PREPARE puis SEND_EMAIL avec l\'identifiant', (await appels()).join(',') === 'prepare,send_email'
    && (await page.evaluate(() => window.__fonction[0].corps.devis_id)) === d.id);
  check('B5 : la relecture serveur du devis n\'a pas été nécessaire', !(await page.evaluate(() => window.__requetes.some(r => r.table === 'devis' && r.op === 'select'))));
  check('B6 : le JWT de la session administrateur est transmis à la fonction', await page.evaluate(() => window.__fonction.every(a => a.auth === 'Bearer jwt-admin-test')));

  // ── C. Après rechargement de la liste (nouvelle session) ──
  await page.evaluate(() => { window._devisParClient = {}; });
  await rearmer();
  await page.evaluate(() => loadDemandesDevis());
  await page.waitForTimeout(300);
  d = await devisMemoire();
  check('C1 : après rechargement, le devis relu depuis la base porte son identifiant et son statut « envoyé »', d && d.id && d.statut === 'envoye', JSON.stringify(d));

  // ── D. Renvoi EXPLICITE depuis « envoyé » ──
  await page.evaluate((dem) => { window._demandesDevisListe = [dem]; }, DEMANDE);
  await page.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
  await page.waitForTimeout(80);
  f = await fiche();
  check('D1 : le bouton propose « Renvoyer au client »', f.bouton === 'Renvoyer au client');
  await rearmer();
  await page.evaluate(() => { window.__confirmer = false; });
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(200);
  check('D2 : la confirmation de renvoi est explicite et annulable — aucun appel si refusée',
    /Renvoyer/.test((await page.evaluate(() => window.__confirmations[0] || ''))) && (await appels()).length === 0);
  await page.evaluate(() => { window.__confirmer = true; });
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  const envoiRenvoi = await page.evaluate(() => (window.__fonction[1] || {}).corps);
  check('D3 : le renvoi est transmis comme tel (renvoi=true), après une nouvelle préparation', envoiRenvoi && envoiRenvoi.renvoi === true && (await appels()).join(',') === 'prepare,send_email');
  check('D4 : toujours un seul devis, statut envoyé', (await page.evaluate(() => window.__db.devis.length)) === 1 && (await devisMemoire()).statut === 'envoye');

  // ── E. Double clic : une seule intention ──
  await rearmer();
  await page.evaluate((id) => { envoyerDevis(id); envoyerDevis(id); envoyerDevis(id); }, DEMANDE.id);
  await page.waitForTimeout(300);
  check('E1 : trois clics -> UN seul PREPARE et UN seul SEND_EMAIL', (await appels()).join(',') === 'prepare,send_email', (await appels()).join(','));

  // ── F. L'identifiant manque VRAIMENT : erreur intégrée, rien d'autre ──
  await page.evaluate((id) => { window._devisParClient[id] = { reference: 'DEV-2026-0062', client_id: id, prix: 450, statut: 'genere', date_generation: '2026-09-09T10:00:00Z' }; window.__recuperationVide = true; }, DEMANDE.id);
  await page.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
  await page.waitForTimeout(80);
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  f = await fiche();
  check('F1 : sans identifiant récupérable -> erreur HelixCar intégrée, traçable (référence), aucune alerte native',
    f.erreurVisible && /introuvable/i.test(f.erreur) && /DEV-2026-0062/.test(f.erreur) && (await page.evaluate(() => window.__alertes.length)) === 0, f.erreur);
  check('F2 : aucun PREPARE, aucun envoi, statut inchangé, aucun devis créé',
    (await appels()).length === 0 && (await devisMemoire()).statut === 'genere' && (await page.evaluate(() => window.__db.devis.length)) === 1);
  check('F3 : le bouton est de nouveau utilisable', f.bouton === 'Envoyer au client' && !f.boutonDesactive);
  await page.evaluate(() => { window.__recuperationVide = false; });

  // ── G. Échecs serveur : pas de faux « envoyé » ──
  await page.evaluate(() => { window.__db = { devis: [], devis_envois: [] }; window._devisParClient = {}; });
  await page.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
  await page.waitForTimeout(80);
  await page.fill('#devis-prix-input', '450');
  await page.evaluate((id) => genererDevis(id), DEMANDE.id);
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__fonctionKo = { action: 'send_email', statut: 502, corps: { ok: false, code: 'EMAIL_SEND_FAILED', message: 'Le prestataire d\'e-mail a refusé l\'envoi (code 502).' } }; });
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  f = await fiche();
  check('G1 : prestataire en échec -> statut inchangé (généré), erreur intégrée, bouton « Réessayer »',
    (await devisMemoire()).statut === 'genere' && f.erreurVisible && /échoué/i.test(f.erreur) && /Réessayer/.test(f.bouton), JSON.stringify(f));
  await page.evaluate(() => { window.__fonctionKo = { action: 'send_email', statut: 500, corps: { ok: false, code: 'EMAIL_SENT_DB_UPDATE_FAILED', message: 'x' } }; });
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  f = await fiche();
  check('G2 : e-mail parti mais état non enregistré -> dit tel quel, « Vérifier le dossier », jamais « pas parti »',
    /est parti/i.test(f.erreur) && f.bouton === 'Vérifier le dossier');
  await page.evaluate(() => { window.__fonctionKo = { action: 'prepare', statut: 409, corps: { ok: false, code: 'INVALID_STATE', message: 'changé d\'état' } }; });
  await rearmer();
  await page.evaluate((id) => envoyerDevis(id), DEMANDE.id);
  await page.waitForTimeout(300);
  check('G3 : PREPARE refusé -> aucun SEND_EMAIL, message intégré', (await appels()).join(',') === 'prepare' && /préparation sécurisée/i.test((await fiche()).erreur));
  await page.evaluate(() => { window.__fonctionKo = null; });

  // ── H. Modifier le prix : nouvelle version, par identifiant ──
  await page.evaluate(() => { window.__prompt = '600'; });
  await rearmer();
  await page.evaluate((id) => modifierPrixDevis(id), DEMANDE.id);
  await page.waitForTimeout(250);
  const maj = await page.evaluate(() => window.__requetes.find(r => r.table === 'devis' && r.op === 'update'));
  d = await devisMemoire();
  check('H1 : la mise à jour du prix cible l\'identifiant et relit la ligne : version 2 en mémoire', maj && maj.relecture && d.prix === 600 && d.version === 2, JSON.stringify(d));
  check('H2 : la fiche affiche la version', /version 2/.test((await fiche()).texte));

  // ── I. Un devis accepté : plus de bouton d'envoi ──
  await page.evaluate((id) => { window._devisParClient[id].statut = 'accepte'; window._devisParClient[id].paiement_statut = 'en_attente'; }, DEMANDE.id);
  await page.evaluate((id) => ouvrirFicheDemande(id), DEMANDE.id);
  await page.waitForTimeout(80);
  f = await fiche();
  check('I1 : devis accepté -> aucun bouton d\'envoi, badge « accepté — paiement en attente »', f.bouton === null && /PAIEMENT EN ATTENTE/.test(f.texte));

  // ── J. Hygiène du code ──
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
  check('J1 : le bouton « Tester PREPARE (QA) » et sa fonction ont disparu', !/testerPrepareDevisQA|btn-test-qa-prepare/.test(dash) && !/Tester PREPARE/.test(dash));
  check('J2 : plus d\'URL absolue de fonction codée en dur', !/supabase\.co\/functions\/v1\/devis-secure/.test(dash) && /URL_FONCTION_DEVIS/.test(dash));
  check('J3 : l\'ancien alert() d\'identifiant absent a disparu', !/alert\('❌ Identifiant interne du devis introuvable/.test(dash));
  check('J4 : le registre des actions ne contient plus le mode test', !/'testerPrepareDevisQA'/.test(dash));
  check('J5 : aucun e-mail EmailJS déclenché par l\'envoi de devis', (await page.evaluate(() => window.__emails.length)) === 0);
  check('Aucune erreur JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (echecs.length) echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail > 0 ? 1 : 0);
})();
